-- 0180 — Playlist Flow AI 엔진. 곡↔곡 전환 흐름 평가 → playlist_flow_score. additive·idempotent.
-- 분석만 수행(진단·점수). playlist_tracks 순서/내용 미변경, 자동 재배치 없음.
-- stream_events / 정산 / 차트 / release_status 미접근.

create table if not exists public.playlist_flow_scores (
  playlist_id uuid primary key references public.playlists(id) on delete cascade,
  flow_score int, n_tracks int not null default 0, n_transitions int not null default 0,
  avg_transition numeric, rough_transitions int not null default 0,
  fatigue_index int not null default 0, monotony_index int not null default 0,
  repetitive_count int not null default 0, drop_shock_count int not null default 0,
  mood_collision_count int not null default 0, emotional_continuity int,
  breakdown jsonb, computed_at timestamptz not null default now()
);
create table if not exists public.playlist_flow_transitions (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  position int not null,
  from_track_id uuid, to_track_id uuid,
  bpm_jump numeric, energy_jump numeric, brightness_jump numeric, vocal_jump numeric, energy_drop numeric,
  transition_score int, issues text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (playlist_id, position)
);
create index if not exists idx_pft_playlist on public.playlist_flow_transitions(playlist_id, position);
alter table public.playlist_flow_scores enable row level security;
alter table public.playlist_flow_transitions enable row level security;
drop policy if exists pfs_admin_read on public.playlist_flow_scores;
create policy pfs_admin_read on public.playlist_flow_scores for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
drop policy if exists pft_admin_read on public.playlist_flow_transitions;
create policy pft_admin_read on public.playlist_flow_transitions for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- 단일 플레이리스트 흐름 계산 (idempotent: transitions delete-rebuild, score upsert)
create or replace function public.admin_compute_playlist_flow(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  has_prev boolean := false;
  p_id uuid; p_bpm numeric; p_energy numeric; p_bright numeric; p_vocal numeric; p_moods text[];
  c_bpm numeric; c_energy numeric; c_bright numeric; c_vocal numeric; c_moods text[];
  d_bpm numeric; d_energy numeric; d_bright numeric; d_vocal numeric; v_drop numeric;
  pb numeric; pe numeric; pbr numeric; pv numeric; pd numeric; pm numeric;
  v_sim boolean; v_miss boolean;
  v_pen numeric; v_ts int; v_issues text[];
  v_overlap int;
  v_pos int := 0; v_n int := 0; v_ntracks int := 0;
  v_sum_ts numeric := 0; v_rough int := 0; v_repeat int := 0; v_dropc int := 0; v_moodc int := 0;
  v_run int := 0; v_maxrun int := 0; v_sum_cont numeric := 0;
  v_avg numeric; v_fatigue numeric; v_monotony numeric; v_cont int; v_flow int; v_title text;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select title into v_title from public.playlists where id = p_playlist_id;
  delete from public.playlist_flow_transitions where playlist_id = p_playlist_id;

  for r in
    select pt.order_index, pt.track_id,
      f.bpm, f.energy, f.brightness, f.vocal_presence, m.ai_moods
    from public.playlist_tracks pt
    join public.tracks t on t.id = pt.track_id
    left join public.track_audio_features f on f.track_id = pt.track_id and f.status = 'done'
    left join public.track_ai_metadata m on m.track_id = pt.track_id
    where pt.playlist_id = p_playlist_id
    order by pt.order_index, pt.created_at
  loop
    v_ntracks := v_ntracks + 1;
    c_moods := r.ai_moods;
    v_miss := (r.bpm is null or r.energy is null);
    -- 결측 시 점프 0 으로 처리(이전 곡 값 차용) + 플래그
    c_bpm := coalesce(r.bpm, p_bpm, 100);
    c_energy := coalesce(r.energy, p_energy, 0.5);
    c_bright := coalesce(r.brightness, p_bright, 0.3);
    c_vocal := coalesce(r.vocal_presence, p_vocal, 0.4);

    if has_prev then
      d_bpm := abs(c_bpm - p_bpm);
      d_energy := abs(c_energy - p_energy);
      d_bright := abs(c_bright - p_bright);
      d_vocal := abs(c_vocal - p_vocal);
      v_drop := p_energy - c_energy;  -- 양수 = 에너지 급락

      pb := least(1, d_bpm / 40.0);
      pe := least(1, d_energy / 0.40);
      pbr := least(1, d_bright / 0.35);
      pv := least(1, d_vocal / 0.50);
      pd := least(1, greatest(0, v_drop - 0.30) / 0.40);

      -- mood collision: 양쪽 mood 있고 교집합 0 이면 충돌
      pm := 0;
      if p_moods is not null and array_length(p_moods,1) > 0 and c_moods is not null and array_length(c_moods,1) > 0 then
        select count(*) into v_overlap from (select unnest(p_moods) intersect select unnest(c_moods)) z;
        if v_overlap = 0 then pm := 0.6; end if;
      end if;

      -- repetitive similarity: 모든 점프가 미세하면 단조로움
      v_sim := (d_bpm < 4 and d_energy < 0.05 and d_bright < 0.04 and d_vocal < 0.06);

      v_pen := pb*22 + pe*24 + pbr*12 + pv*14 + pd*16 + pm*12;
      v_ts := round(100 - least(100, v_pen));

      v_issues := '{}';
      if v_miss then v_issues := array_append(v_issues, 'missing_features'); end if;
      if pb >= 0.6 then v_issues := array_append(v_issues, 'bpm_jump'); end if;
      if pe >= 0.6 then v_issues := array_append(v_issues, 'energy_jump'); end if;
      if pbr >= 0.6 then v_issues := array_append(v_issues, 'brightness_jump'); end if;
      if pv >= 0.6 then v_issues := array_append(v_issues, 'vocal_collision'); end if;
      if pd >= 0.5 then v_issues := array_append(v_issues, 'drop_shock'); end if;
      if pm >= 0.5 then v_issues := array_append(v_issues, 'mood_collision'); end if;
      if v_sim then v_issues := array_append(v_issues, 'repetitive_similarity'); end if;

      insert into public.playlist_flow_transitions(playlist_id, position, from_track_id, to_track_id,
        bpm_jump, energy_jump, brightness_jump, vocal_jump, energy_drop, transition_score, issues)
      values (p_playlist_id, v_pos, p_id, r.track_id,
        round(d_bpm,1), round(d_energy,3), round(d_bright,3), round(d_vocal,3), round(v_drop,3), v_ts, v_issues);

      v_sum_ts := v_sum_ts + v_ts; v_n := v_n + 1; v_pos := v_pos + 1;
      v_sum_cont := v_sum_cont + (d_energy*0.6 + d_bright*0.4);
      if v_ts < 60 then v_rough := v_rough + 1; v_run := v_run + 1; v_maxrun := greatest(v_maxrun, v_run); else v_run := 0; end if;
      if v_sim then v_repeat := v_repeat + 1; end if;
      if pd >= 0.5 then v_dropc := v_dropc + 1; end if;
      if pm >= 0.5 then v_moodc := v_moodc + 1; end if;
    end if;

    p_id := r.track_id; p_bpm := c_bpm; p_energy := c_energy; p_bright := c_bright; p_vocal := c_vocal; p_moods := c_moods;
    has_prev := true;
  end loop;

  if v_n = 0 then
    insert into public.playlist_flow_scores(playlist_id, flow_score, n_tracks, n_transitions, computed_at)
    values (p_playlist_id, null, v_ntracks, 0, now())
    on conflict (playlist_id) do update set flow_score=null, n_tracks=excluded.n_tracks, n_transitions=0, computed_at=now(),
      avg_transition=null, rough_transitions=0, fatigue_index=0, monotony_index=0, repetitive_count=0, drop_shock_count=0, mood_collision_count=0, emotional_continuity=null, breakdown=null;
    return jsonb_build_object('ok', true, 'playlist_id', p_playlist_id, 'title', v_title, 'flow_score', null, 'n_tracks', v_ntracks, 'n_transitions', 0, 'note', '곡 2개 미만 — 흐름 평가 불가');
  end if;

  v_avg := v_sum_ts / v_n;
  v_fatigue := least(15, greatest(0, v_maxrun - 1) * 5);
  v_monotony := least(15, (v_repeat::numeric / v_n) * 30);
  v_cont := round(100 - least(100, (v_sum_cont / v_n) / 0.40 * 100));
  v_flow := greatest(0, least(100, round(v_avg - v_fatigue - v_monotony)));

  insert into public.playlist_flow_scores(playlist_id, flow_score, n_tracks, n_transitions, avg_transition,
    rough_transitions, fatigue_index, monotony_index, repetitive_count, drop_shock_count, mood_collision_count, emotional_continuity, breakdown, computed_at)
  values (p_playlist_id, v_flow, v_ntracks, v_n, round(v_avg,1),
    v_rough, round(v_fatigue)::int, round(v_monotony)::int, v_repeat, v_dropc, v_moodc, v_cont,
    jsonb_build_object('fatigue_penalty', round(v_fatigue,1), 'monotony_penalty', round(v_monotony,1), 'max_rough_run', v_maxrun), now())
  on conflict (playlist_id) do update set
    flow_score=excluded.flow_score, n_tracks=excluded.n_tracks, n_transitions=excluded.n_transitions, avg_transition=excluded.avg_transition,
    rough_transitions=excluded.rough_transitions, fatigue_index=excluded.fatigue_index, monotony_index=excluded.monotony_index,
    repetitive_count=excluded.repetitive_count, drop_shock_count=excluded.drop_shock_count, mood_collision_count=excluded.mood_collision_count,
    emotional_continuity=excluded.emotional_continuity, breakdown=excluded.breakdown, computed_at=now();

  return jsonb_build_object('ok', true, 'playlist_id', p_playlist_id, 'title', v_title,
    'flow_score', v_flow, 'n_tracks', v_ntracks, 'n_transitions', v_n, 'avg_transition', round(v_avg,1),
    'rough_transitions', v_rough, 'fatigue_index', round(v_fatigue)::int, 'monotony_index', round(v_monotony)::int,
    'repetitive_count', v_repeat, 'drop_shock_count', v_dropc, 'mood_collision_count', v_moodc, 'emotional_continuity', v_cont);
end; $$;
grant execute on function public.admin_compute_playlist_flow(uuid) to authenticated;

-- 전체(곡 보유) 플레이리스트 일괄 계산
create or replace function public.admin_compute_all_playlist_flows()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_n int := 0;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in select distinct playlist_id from public.playlist_tracks loop
    perform public.admin_compute_playlist_flow(r.playlist_id);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'playlists_scored', v_n);
end; $$;
grant execute on function public.admin_compute_all_playlist_flows() to authenticated;

-- 대시보드 요약 (흐름 낮은 순)
create or replace function public.admin_playlist_flow_summary()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by (x.flow_score is null), x.flow_score asc nulls last), '[]'::jsonb) into v from (
    select s.playlist_id, p.title, s.flow_score, s.n_tracks, s.n_transitions, s.avg_transition,
      s.rough_transitions, s.fatigue_index, s.monotony_index, s.repetitive_count, s.drop_shock_count,
      s.mood_collision_count, s.emotional_continuity, s.computed_at
    from public.playlist_flow_scores s join public.playlists p on p.id = s.playlist_id) x;
  return v;
end; $$;
grant execute on function public.admin_playlist_flow_summary() to authenticated;

-- 단일 플레이리스트 상세 (전환별 + 곡 제목)
create or replace function public.admin_get_playlist_flow(p_playlist_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_score jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select to_jsonb(s) || jsonb_build_object('title', p.title) into v_score
  from public.playlist_flow_scores s join public.playlists p on p.id = s.playlist_id where s.playlist_id = p_playlist_id;
  select coalesce(jsonb_agg(row_to_json(x) order by x.position), '[]'::jsonb) into v from (
    select tr.position, tr.from_track_id, tr.to_track_id,
      tf.title as from_title, tt.title as to_title,
      tr.bpm_jump, tr.energy_jump, tr.brightness_jump, tr.vocal_jump, tr.energy_drop, tr.transition_score, tr.issues
    from public.playlist_flow_transitions tr
    left join public.tracks tf on tf.id = tr.from_track_id
    left join public.tracks tt on tt.id = tr.to_track_id
    where tr.playlist_id = p_playlist_id) x;
  return jsonb_build_object('score', v_score, 'transitions', v);
end; $$;
grant execute on function public.admin_get_playlist_flow(uuid) to authenticated;
