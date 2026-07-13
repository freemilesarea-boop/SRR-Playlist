-- ============================================
-- 0485_admin_playlist_experiments.sql
--
-- Phase AI-PLAYLIST-2 — Adaptive Playlist Optimization & Experimentation.
--
-- Playlist 를 AI 가 바로 교체하지 않고 **실험 → 비교 → 검증 → 승인 → 확산** 으로 안전하게
-- 발전시킨다. 이 마이그레이션은 **자동 Playlist 교체를 하지 않는다** — Experiment 저장 +
-- 실제 재생 이벤트(playback_events_v2) 기반 비교(읽기 전용) + 승자 기록(Evidence 필수)만.
--
-- 기존 Playback/Queue/Scheduler/Recommendation/Playlist 구조/Policy 무변경(재사용·읽기만).
-- 비교 원천: playback_events_v2 (0484 헬퍼 _playlist_time_band/_playlist_season/_range 재사용).
--
-- 절대 조건: Evidence 없는 Winner 금지 / Sample 부족 시 '비교 불가' / 자동 교체 없음 /
--   존재하는 KPI 만 / 점수·비율 clamp / NaN·Infinity 금지 / SECURITY DEFINER+search_path.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.
-- range/time_band/season 헬퍼는 0484 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Playlist Experiment 저장소.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.playlist_experiments (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  scope_type       text not null default 'all' check (scope_type in ('all','industry','store_type','time','season')),
  scope_value      text,
  range            text not null default '30d' check (range in ('7d','30d','90d','12m')),
  playlist_a_id    uuid,
  playlist_a_title text,
  playlist_b_id    uuid,
  playlist_b_title text,
  status           text not null default 'draft' check (status in ('draft','running','completed','cancelled')),
  winner           text check (winner in ('a','b','tie','insufficient') or winner is null),
  result           jsonb,          -- 비교 스냅샷(A/B KPI)
  evidence         jsonb,          -- 승자 근거(완료 시 필수)
  started_at       timestamptz,
  ended_at         timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.playlist_experiments is
  'AI-PLAYLIST-2 — Playlist A/B 실험. 자동 교체 없음; 실제 KPI 비교 + 승자 기록(Evidence 필수)만.';

create index if not exists idx_playlist_exp_status on public.playlist_experiments (status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Experiment 생성/수정(draft 기본). 자동 실행/교체 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_playlist_experiment_upsert(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_scope text := coalesce(p_payload->>'scope_type', 'all');
  v_range text := coalesce(p_payload->>'range', '30d');
  v_row public.playlist_experiments;
begin
  perform public._admin_growth_guard();

  if coalesce(p_payload->>'name','') = '' then
    raise exception 'name required' using errcode = '22023';
  end if;
  if v_scope not in ('all','industry','store_type','time','season') then
    raise exception 'invalid scope_type' using errcode = '22023';
  end if;
  if v_range not in ('7d','30d','90d','12m') then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  if (p_payload->>'playlist_a_id') is null or (p_payload->>'playlist_b_id') is null then
    raise exception 'playlist_a_id/playlist_b_id required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.playlist_experiments(
      name, scope_type, scope_value, range, playlist_a_id, playlist_a_title, playlist_b_id, playlist_b_title, status, created_by
    ) values (
      p_payload->>'name', v_scope, nullif(p_payload->>'scope_value',''), v_range,
      (p_payload->>'playlist_a_id')::uuid, p_payload->>'playlist_a_title',
      (p_payload->>'playlist_b_id')::uuid, p_payload->>'playlist_b_title', 'draft', auth.uid()
    ) returning id into v_id;
  else
    update public.playlist_experiments set
      name = p_payload->>'name', scope_type = v_scope, scope_value = nullif(p_payload->>'scope_value',''), range = v_range,
      playlist_a_id = (p_payload->>'playlist_a_id')::uuid, playlist_a_title = p_payload->>'playlist_a_title',
      playlist_b_id = (p_payload->>'playlist_b_id')::uuid, playlist_b_title = p_payload->>'playlist_b_title',
      updated_at = now()
    where id = p_id and status = 'draft'   -- draft 만 수정 가능(진행중 실험 보호)
    returning id into v_id;
    if v_id is null then
      raise exception 'experiment not found or not editable (draft only)' using errcode = 'P0002';
    end if;
  end if;

  select * into v_row from public.playlist_experiments where id = v_id;
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_playlist_experiment_upsert(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 상태 전환(draft→running→completed/cancelled). 교체 아님(상태만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_playlist_experiment_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.playlist_experiments;
begin
  perform public._admin_growth_guard();
  if p_status not in ('draft','running','completed','cancelled') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  update public.playlist_experiments set
    status = p_status,
    started_at = case when p_status = 'running' and started_at is null then now() else started_at end,
    ended_at = case when p_status in ('completed','cancelled') then now() else ended_at end,
    updated_at = now()
  where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'experiment not found: %', p_id using errcode = 'P0002';
  end if;
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_playlist_experiment_set_status(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Experiment 목록.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_playlist_experiments(p_status text default null, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_result
  from (
    select e.*, u.nickname as created_by_name
    from public.playlist_experiments e
    left join public.users u on u.id = e.created_by
    where p_status is null or e.status = p_status
    order by e.created_at desc limit v_limit
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_playlist_experiments(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) A/B 비교 — playback_events_v2 에서 두 Playlist 의 KPI 를 scope 필터로 집계(읽기 전용).
--    승자 판정은 프론트 playlistExperiment.ts(순수 로직). 여기서는 원자료만.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_playlist_compare(
  p_playlist_a uuid, p_playlist_b uuid,
  p_scope_type text default 'all', p_scope_value text default null, p_range text default '30d'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._playlist_range_interval(p_range);
  v_rows jsonb;
begin
  perform public._admin_growth_guard();

  if p_scope_type not in ('all','industry','store_type','time','season') then
    raise exception 'invalid scope_type' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows
  from (
    select e.playlist_id, p.title as playlist_title,
      count(*) as events,
      count(*) filter (where e.event_type='skip') as skips,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(avg(e.listened_seconds)::numeric, 1) as avg_listen_seconds,
      count(*) filter (where e.event_type='like') as likes,
      count(*) filter (where e.event_type='replay') as replays,
      count(distinct e.track_id) as unique_tracks
    from public.playback_events_v2 e
    left join public.playlists p on p.id = e.playlist_id
    where e.playlist_id = any(array[p_playlist_a, p_playlist_b])
      and e.created_at >= v_since
      and (
        p_scope_type = 'all'
        or (p_scope_type in ('industry','store_type') and e.store_type_slug = p_scope_value)
        or (p_scope_type = 'time' and public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) = p_scope_value)
        or (p_scope_type = 'season' and public._playlist_season(extract(month from (e.created_at at time zone 'Asia/Seoul'))::int) = p_scope_value)
      )
    group by e.playlist_id, p.title
  ) t;

  return jsonb_build_object(
    'playlist_a', p_playlist_a, 'playlist_b', p_playlist_b,
    'scope_type', p_scope_type, 'scope_value', p_scope_value, 'range', coalesce(p_range,'30d'),
    'rows', v_rows, 'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_playlist_compare(uuid, uuid, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 실험 종결 — 승자 기록. Evidence 필수(근거 없는 Winner 금지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_playlist_experiment_conclude(
  p_id uuid, p_winner text, p_result jsonb, p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.playlist_experiments;
begin
  perform public._admin_growth_guard();

  if p_winner not in ('a','b','tie','insufficient') then
    raise exception 'invalid winner' using errcode = '22023';
  end if;
  -- insufficient(비교 불가) 이외에는 Evidence 필수.
  if p_winner <> 'insufficient' and (p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0) then
    raise exception 'evidence required for a winner (근거 없는 Winner 금지)' using errcode = '22023';
  end if;

  update public.playlist_experiments set
    status = 'completed', winner = p_winner, result = p_result, evidence = coalesce(p_evidence, '[]'::jsonb),
    ended_at = now(), updated_at = now()
  where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'experiment not found: %', p_id using errcode = 'P0002';
  end if;
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_playlist_experiment_conclude(uuid, text, jsonb, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Experiment Learning 집계(참고용; 자동 Rule/Weight 변경 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_playlist_experiment_learning()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.wins desc), '[]'::jsonb) into v_result
  from (
    select coalesce(
             case when e.winner='a' then e.playlist_a_title when e.winner='b' then e.playlist_b_title end,
             '(무승부/비교불가)') as playlist_title,
      count(*) filter (where e.winner in ('a','b')) as wins,
      count(*) as appearances
    from public.playlist_experiments e
    where e.status = 'completed'
    group by playlist_title
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_playlist_experiment_learning() to authenticated;
