-- ============================================
-- 0566_ai_playlist_sequencing.sql
--
-- Phase AI-PLAYLIST-INTEL-2 — Sequencing Intelligence & Transition Planning.
--
-- Phase 1(0565) Playlist Draft 위에 **재생 순서 초안(Sequenced Draft)** 을 Shadow 로
-- 저장한다. 실제 재생 경로는 일절 변경하지 않는다:
--   playlist_tracks(order_index 포함) UPDATE 없음 · Queue/Scheduler/Player 연결 없음 ·
--   get_playlist_tracks/recommend_*/Auto Placement/일일 Refresh 무변경 ·
--   Publish/Apply RPC 자체가 존재하지 않는다.
--
-- 흐름: Playlist Draft(0565) → Sequence Input → 순서 초안 저장(서버가 Track Set 불변
--       + Hard Gate 재검증) → 서버 Quality 재계산 → Human Review. 여기서 종료.
--
-- 재사용: _admin_growth_guard(0472) · _touch_updated_at(0025) ·
--   _ai_pl_hard_violations(0565 — 원본 Draft constraint_snapshot 로 재검증) ·
--   ai_playlist_drafts/ai_playlist_draft_tracks(0565).
-- Key/Camelot 데이터는 저장소에 존재하지 않으므로(항상 null) Harmonic 평가는
-- not_available 로 제외한다. 결측 Energy/BPM 을 보간해 실제 값처럼 저장하지 않는다.
--
-- 서버 Quality 가중치(코드 상수 SEQ_QUALITY_WEIGHTS 와 동일):
--   hard 20 · artistSpacing 15 · energyFlow 15 · genreFlow 10 · bpmFlow 10 ·
--   vocalFlow 10 · albumSpacing 5 · moodFlow 5 · fatigueControl 5 · metadata 5.
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Sequence Draft 본체 — 원본 Draft 삭제 시 Sequence 도 함께 삭제(cascade)는
--    Shadow 계보 내부 정책이며 Production Playlist 와는 Cascade 연결이 없다.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_playlist_sequence_drafts (
  id                 uuid primary key default gen_random_uuid(),
  playlist_draft_id  uuid not null references public.ai_playlist_drafts(id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 200),
  strategy           text not null default 'balanced'
    check (strategy in ('balanced','smooth','energy_rise','energy_fall','steady','daypart','manual_assist')),
  status             text not null default 'draft'
    check (status in ('draft','ready_for_review','approved','rejected','expired','archived')),
  seed               bigint not null default 1,
  algorithm_version  text not null,
  input_snapshot     jsonb not null default '{}'::jsonb,
  constraint_snapshot jsonb not null default '{}'::jsonb,
  relaxations        jsonb not null default '[]'::jsonb,
  energy_curve       jsonb not null default '[]'::jsonb,
  quality_score      numeric check (quality_score is null or (quality_score >= 0 and quality_score <= 100)),
  quality_grade      text check (quality_grade is null or quality_grade in ('A','B','C','D','insufficient_data')),
  quality_breakdown  jsonb not null default '{}'::jsonb,
  transition_summary jsonb not null default '{}'::jsonb,
  explanation        jsonb not null default '[]'::jsonb,
  warnings           jsonb not null default '[]'::jsonb,
  insufficient_data  jsonb not null default '[]'::jsonb,
  input_hash         text,
  created_by         uuid,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  rejection_reason   text,
  expires_at         timestamptz not null default now() + interval '30 days',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.ai_playlist_sequence_drafts is
  'AI-PLAYLIST-INTEL-2 — 재생 순서 초안(Shadow). playlist_tracks/Queue/Player 미반영. Approved=검토 감사 기록.';

create index if not exists idx_ai_pl_seq_status on public.ai_playlist_sequence_drafts (status, created_at desc);
create index if not exists idx_ai_pl_seq_source on public.ai_playlist_sequence_drafts (playlist_draft_id, created_at desc);
create index if not exists idx_ai_pl_seq_hash on public.ai_playlist_sequence_drafts (input_hash, created_at desc);

drop trigger if exists tg_ai_pl_seq_touch on public.ai_playlist_sequence_drafts;
create trigger tg_ai_pl_seq_touch before update on public.ai_playlist_sequence_drafts
  for each row execute function public._touch_updated_at();

alter table public.ai_playlist_sequence_drafts enable row level security;
-- 정책 없음(deny-all) — 접근은 관리자 SECURITY DEFINER RPC 로만.

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Sequence Track — 순서 + Transition Evidence. Track FK 는 Production→Draft
--    단방향 cascade(트랙 hard-delete 시 초안 행 정리).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_playlist_sequence_tracks (
  id                      uuid primary key default gen_random_uuid(),
  sequence_draft_id       uuid not null references public.ai_playlist_sequence_drafts(id) on delete cascade,
  track_id                uuid not null references public.tracks(id) on delete cascade,
  sequence_position       int not null check (sequence_position >= 0),
  original_draft_order    int,
  transition_from_track_id uuid,
  transition_score        numeric check (transition_score is null or (transition_score >= 0 and transition_score <= 100)),
  energy_delta            numeric,
  bpm_delta               numeric,
  reasons                 jsonb not null default '[]'::jsonb,
  warnings                jsonb not null default '[]'::jsonb,
  feature_snapshot        jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  unique (sequence_draft_id, track_id),
  unique (sequence_draft_id, sequence_position)
);

create index if not exists idx_ai_pl_seq_tracks on public.ai_playlist_sequence_tracks (sequence_draft_id, sequence_position);

alter table public.ai_playlist_sequence_tracks enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Sequence Audit Event
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_playlist_sequence_events (
  id                uuid primary key default gen_random_uuid(),
  sequence_draft_id uuid not null references public.ai_playlist_sequence_drafts(id) on delete cascade,
  event_type        text not null check (event_type in ('created','reevaluated','status_changed','note')),
  actor_id          uuid,
  previous_status   text,
  next_status       text,
  reason            text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_ai_pl_seq_events on public.ai_playlist_sequence_events (sequence_draft_id, created_at desc);

alter table public.ai_playlist_sequence_events enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Sequence Input — Phase 1 Draft 의 선택 Track 을 live feature 와 함께 반환.
--    vocal_presence/instrumental/album 은 Draft snapshot 에 없어 live join 으로
--    보강한다(결측은 null 그대로 — 보간 금지). 읽기 전용.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_pl_seq_input(p_draft_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare d record; v_tracks jsonb;
begin
  perform public._admin_growth_guard();

  select id, name, status, store_type, constraint_snapshot, selected_track_count
    into d from public.ai_playlist_drafts where id = p_draft_id;
  if d.id is null then raise exception 'draft not found: %', p_draft_id using errcode = 'P0002'; end if;
  if d.status in ('rejected','expired','archived') then
    raise exception 'draft status % not sequenceable', d.status using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.original_draft_order), '[]'::jsonb) into v_tracks
  from (
    select dt.track_id, dt.draft_order as original_draft_order,
      tr.title, tr.artist, tr.album_name, tr.main_genre, tr.mood,
      tr.instrumental, tr.release_date,
      af.energy, af.vocal_presence, coalesce(af.bpm, tr.bpm) as bpm,
      (dt.feature_snapshot->>'fit_score')::numeric as fit_score,
      (dt.feature_snapshot->>'events')::numeric as events
    from public.ai_playlist_draft_tracks dt
    join public.tracks tr on tr.id = dt.track_id
    left join public.track_audio_features af on af.track_id = dt.track_id
    where dt.draft_id = p_draft_id and dt.selected
  ) t;

  return jsonb_build_object(
    'draft_id', d.id, 'draft_name', d.name, 'draft_status', d.status,
    'store_type', d.store_type, 'constraint_snapshot', d.constraint_snapshot,
    'tracks', v_tracks, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_pl_seq_input(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 서버측 Sequence Quality 재계산 — 클라이언트 점수를 저장하지 않는다.
--    저장된 순서 + live join 으로 인접/흐름/결측을 집계한다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public._ai_pl_seq_quality(p_seq_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record; src record;
  v_n int; v_pairs int;
  v_adj_artist int; v_adj_album int; v_adj_genre int;
  v_max_genre_run int; v_max_mood_run int; v_max_vocal_run int;
  v_energy_avg_d numeric; v_energy_max_d numeric; v_energy_missing int;
  v_bpm_avg_d numeric; v_bpm_max_d numeric; v_bpm_missing int;
  v_vocal_missing int; v_fatigue_adj int;
  v_set_ok boolean; v_dup int; v_missing_pos int;
  v_hard jsonb := '[]'::jsonb; v_hard_arr text[] := '{}';
  v_c_hard numeric; v_c_artist numeric; v_c_album numeric; v_c_genre numeric; v_c_mood numeric;
  v_c_energy numeric; v_c_bpm numeric; v_c_vocal numeric; v_c_fatigue numeric; v_c_meta numeric;
  v_missing_ratio numeric; v_score numeric; v_grade text;
  v_genre_cap int; v_vocal_cap int;
begin
  select * into s from public.ai_playlist_sequence_drafts where id = p_seq_id;
  if s.id is null then raise exception 'sequence not found: %', p_seq_id using errcode = 'P0002'; end if;
  select * into src from public.ai_playlist_drafts where id = s.playlist_draft_id;

  v_genre_cap := coalesce((s.constraint_snapshot->>'max_genre_run')::int, 3);
  v_vocal_cap := coalesce((s.constraint_snapshot->>'max_vocal_run')::int, 3);

  select count(*) into v_n from public.ai_playlist_sequence_tracks st where st.sequence_draft_id = p_seq_id;
  if v_n < 2 then
    return jsonb_build_object('score', null, 'grade', 'insufficient_data', 'hard_violations',
      jsonb_build_array('too_few_tracks'), 'breakdown', '{}'::jsonb);
  end if;
  v_pairs := v_n - 1;

  -- Track Set 불변 검증: 원본 Draft 선택 집합과 완전 일치 + 중복/位置 무결성.
  select count(*) into v_dup from (
    select track_id from public.ai_playlist_sequence_tracks where sequence_draft_id = p_seq_id
    group by track_id having count(*) > 1) x;
  select count(*) into v_missing_pos from (
    select generate_series(0, v_n - 1) as pos
    except select sequence_position from public.ai_playlist_sequence_tracks where sequence_draft_id = p_seq_id) x;
  v_set_ok := not exists (
      select dt.track_id from public.ai_playlist_draft_tracks dt
      where dt.draft_id = s.playlist_draft_id and dt.selected
      except select st.track_id from public.ai_playlist_sequence_tracks st where st.sequence_draft_id = p_seq_id)
    and not exists (
      select st.track_id from public.ai_playlist_sequence_tracks st where st.sequence_draft_id = p_seq_id
      except select dt.track_id from public.ai_playlist_draft_tracks dt
      where dt.draft_id = s.playlist_draft_id and dt.selected);
  if v_dup > 0 then v_hard_arr := array_append(v_hard_arr, 'duplicate_track'); end if;
  if v_missing_pos > 0 then v_hard_arr := array_append(v_hard_arr, 'position_gap'); end if;
  if not v_set_ok then v_hard_arr := array_append(v_hard_arr, 'track_set_mismatch'); end if;

  -- 원본 Draft 의 Hard Policy 재검증(0565 재사용).
  v_hard := public._ai_pl_hard_violations(
    (select array_agg(st.track_id) from public.ai_playlist_sequence_tracks st where st.sequence_draft_id = p_seq_id),
    src.store_type, src.source_playlist_id,
    coalesce((src.constraint_snapshot->>'block_explicit')::boolean, false),
    coalesce((src.constraint_snapshot->>'require_instrumental')::boolean, false),
    (src.constraint_snapshot->>'min_qc')::numeric);
  if jsonb_array_length(v_hard) > 0 then v_hard_arr := array_append(v_hard_arr, 'source_policy_violation'); end if;

  with seq as (
    select st.sequence_position as pos, st.track_id,
      lower(coalesce(tr.artist,'')) as artist, lower(coalesce(tr.album_name,'')) as album,
      lower(coalesce(tr.main_genre,'')) as genre, coalesce(tr.mood,'') as mood,
      af.energy, coalesce(af.bpm, tr.bpm) as bpm,
      case when tr.instrumental is true then false
           when tr.instrumental is false then true
           when af.vocal_presence is not null then af.vocal_presence >= 0.5
           else null end as is_vocal,
      least(100, coalesce((st.feature_snapshot->>'events')::numeric, 0) / 80 * 100) as fatigue
    from public.ai_playlist_sequence_tracks st
    join public.tracks tr on tr.id = st.track_id
    left join public.track_audio_features af on af.track_id = st.track_id
    where st.sequence_draft_id = p_seq_id
  ), pair as (
    select pos, artist, album, genre, mood, energy, bpm, is_vocal, fatigue,
      lag(artist) over w as p_artist, lag(album) over w as p_album, lag(genre) over w as p_genre,
      lag(energy) over w as p_energy, lag(bpm) over w as p_bpm, lag(fatigue) over w as p_fatigue
    from seq window w as (order by pos)
  ), runs as (
    select genre, mood, is_vocal, pos,
      pos - row_number() over (partition by genre order by pos) as g_grp,
      pos - row_number() over (partition by mood order by pos) as m_grp,
      pos - row_number() over (partition by is_vocal order by pos) as v_grp
    from seq
  )
  select
    (select count(*) from pair where p_artist is not null and artist <> '' and artist = p_artist),
    (select count(*) from pair where p_album is not null and album <> '' and album = p_album),
    (select count(*) from pair where p_genre is not null and genre <> '' and genre = p_genre),
    (select coalesce(max(c),0) from (select count(*) as c from runs where genre <> '' group by genre, g_grp) x),
    (select coalesce(max(c),0) from (select count(*) as c from runs where mood <> '' group by mood, m_grp) x),
    (select coalesce(max(c),0) from (select count(*) as c from runs where is_vocal is true group by v_grp) x),
    (select avg(abs(energy - p_energy)) from pair where energy is not null and p_energy is not null),
    (select max(abs(energy - p_energy)) from pair where energy is not null and p_energy is not null),
    (select count(*) from seq where energy is null),
    (select avg(abs(bpm - p_bpm)) from pair where bpm is not null and p_bpm is not null),
    (select max(abs(bpm - p_bpm)) from pair where bpm is not null and p_bpm is not null),
    (select count(*) from seq where bpm is null),
    (select count(*) from seq where is_vocal is null),
    (select count(*) from pair where fatigue >= 60 and p_fatigue >= 60)
  into v_adj_artist, v_adj_album, v_adj_genre, v_max_genre_run, v_max_mood_run, v_max_vocal_run,
       v_energy_avg_d, v_energy_max_d, v_energy_missing, v_bpm_avg_d, v_bpm_max_d, v_bpm_missing,
       v_vocal_missing, v_fatigue_adj;

  v_missing_ratio := (v_energy_missing + v_bpm_missing + v_vocal_missing)::numeric / (3 * v_n);

  v_c_hard := case when array_length(v_hard_arr, 1) is null then 100 else 0 end;
  v_c_artist := greatest(0, 100 - (v_adj_artist::numeric / v_pairs) * 200);
  v_c_album := greatest(0, 100 - (v_adj_album::numeric / v_pairs) * 200);
  v_c_genre := greatest(0, 100 - greatest(0, v_max_genre_run - v_genre_cap) * 25);
  v_c_mood := greatest(0, 100 - greatest(0, v_max_mood_run - v_genre_cap) * 25);
  v_c_energy := case when v_energy_missing >= v_n then null
    else greatest(0, 100 - coalesce(v_energy_avg_d, 0) * 200) end;
  v_c_bpm := case when v_bpm_missing >= v_n then null
    else greatest(0, 100 - coalesce(v_bpm_avg_d, 0) * 2) end;
  v_c_vocal := case when v_vocal_missing >= v_n then null
    else greatest(0, 100 - greatest(0, v_max_vocal_run - v_vocal_cap) * 20) end;
  v_c_fatigue := greatest(0, 100 - (v_fatigue_adj::numeric / v_pairs) * 200);
  v_c_meta := round((1 - v_missing_ratio) * 100, 1);

  if v_missing_ratio > 0.4 or array_length(v_hard_arr, 1) is not null then
    v_score := case when array_length(v_hard_arr, 1) is not null then 0 else null end;
    v_grade := case when array_length(v_hard_arr, 1) is not null then 'D' else 'insufficient_data' end;
  else
    select round(sum(val * w) / nullif(sum(w), 0), 1) into v_score from (values
      (v_c_hard, 20::numeric), (v_c_artist, 15), (v_c_energy, 15), (v_c_genre, 10),
      (v_c_bpm, 10), (v_c_vocal, 10), (v_c_album, 5), (v_c_mood, 5), (v_c_fatigue, 5), (v_c_meta, 5)
    ) t(val, w) where val is not null;
    v_grade := case when v_score is null then 'insufficient_data'
      when v_score >= 85 then 'A' when v_score >= 70 then 'B' when v_score >= 55 then 'C' else 'D' end;
  end if;

  return jsonb_build_object(
    'score', v_score, 'grade', v_grade,
    'hard_violations', to_jsonb(coalesce(v_hard_arr, '{}')), 'hard_detail', v_hard,
    'missing_ratio', round(v_missing_ratio, 3),
    'transition_summary', jsonb_build_object(
      'adjacent_same_artist', v_adj_artist, 'adjacent_same_album', v_adj_album,
      'adjacent_same_genre', v_adj_genre, 'max_genre_run', v_max_genre_run,
      'max_mood_run', v_max_mood_run, 'max_vocal_run', v_max_vocal_run,
      'avg_energy_delta', round(coalesce(v_energy_avg_d, 0), 3), 'max_energy_delta', round(coalesce(v_energy_max_d, 0), 3),
      'avg_bpm_delta', round(coalesce(v_bpm_avg_d, 0), 1), 'max_bpm_delta', round(coalesce(v_bpm_max_d, 0), 1),
      'energy_missing', v_energy_missing, 'bpm_missing', v_bpm_missing, 'vocal_missing', v_vocal_missing,
      'high_fatigue_adjacent', v_fatigue_adj, 'harmonic_transition', 'not_available'),
    'breakdown', jsonb_build_object(
      'hardConstraintCompliance', v_c_hard, 'artistSpacing', round(v_c_artist, 1), 'albumSpacing', round(v_c_album, 1),
      'genreFlow', round(v_c_genre, 1), 'moodFlow', round(v_c_mood, 1),
      'energyFlow', case when v_c_energy is null then null else round(v_c_energy, 1) end,
      'bpmFlow', case when v_c_bpm is null then null else round(v_c_bpm, 1) end,
      'vocalFlow', case when v_c_vocal is null then null else round(v_c_vocal, 1) end,
      'fatigueControl', round(v_c_fatigue, 1), 'metadataCompleteness', v_c_meta, 'overallScore', v_score));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Sequence 생성 — 서버가 Track Set 불변 + Hard Gate 재검증. 위반 시 저장 거부.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_pl_seq_create(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_draft_id uuid := nullif(p_payload->>'playlist_draft_id','')::uuid;
  v_name text := p_payload->>'name';
  v_strategy text := coalesce(nullif(p_payload->>'strategy',''), 'balanced');
  v_order jsonb := p_payload->'ordering';
  d record; v_hash text; v_dup uuid; v_id uuid;
  v_expected int; v_given int; v_item jsonb; v_quality jsonb; v_warn jsonb;
begin
  perform public._admin_growth_guard();

  if v_draft_id is null then raise exception 'playlist_draft_id required' using errcode = '22023'; end if;
  if coalesce(v_name,'') = '' then raise exception 'name required' using errcode = '22023'; end if;
  if v_order is null or jsonb_typeof(v_order) <> 'array' or jsonb_array_length(v_order) < 2 then
    raise exception 'ordering must contain >= 2 tracks' using errcode = '22023';
  end if;
  if jsonb_array_length(v_order) > 200 then
    raise exception 'too many tracks (max 200)' using errcode = '22023';
  end if;
  if length(p_payload::text) > 400000 then
    raise exception 'payload too large' using errcode = '22023';
  end if;

  select * into d from public.ai_playlist_drafts where id = v_draft_id;
  if d.id is null then raise exception 'draft not found: %', v_draft_id using errcode = 'P0002'; end if;
  if d.status in ('rejected','expired','archived') then
    raise exception 'draft status % not sequenceable', d.status using errcode = '22023';
  end if;
  v_warn := coalesce(p_payload->'warnings', '[]'::jsonb);
  if d.status <> 'approved' then
    v_warn := v_warn || jsonb_build_array('원본 Draft 가 approved 상태가 아닙니다(' || d.status || ') — Preview 성격의 Sequence 입니다.');
  end if;

  -- 순서 배열이 원본 선택 집합의 순열인지 서버가 직접 검증(개수+집합 동등).
  select count(*) into v_expected from public.ai_playlist_draft_tracks dt
  where dt.draft_id = v_draft_id and dt.selected;
  v_given := jsonb_array_length(v_order);
  if v_given <> v_expected then
    raise exception 'sequence_generation_failed: track count mismatch (draft %, ordering %)', v_expected, v_given
      using errcode = '23514';
  end if;
  if exists (
    select (e->>'track_id')::uuid from jsonb_array_elements(v_order) e
    except
    select dt.track_id from public.ai_playlist_draft_tracks dt where dt.draft_id = v_draft_id and dt.selected
  ) or exists (
    select dt.track_id from public.ai_playlist_draft_tracks dt where dt.draft_id = v_draft_id and dt.selected
    except
    select (e->>'track_id')::uuid from jsonb_array_elements(v_order) e
  ) then
    raise exception 'sequence_generation_failed: track set mismatch (hard_constraint_conflict, manual_review_required)'
      using errcode = '23514';
  end if;

  v_hash := md5(v_draft_id::text || v_strategy || coalesce(p_payload->>'seed','1')
    || coalesce(p_payload->'constraint_snapshot', '{}'::jsonb)::text || v_order::text);
  select id into v_dup from public.ai_playlist_sequence_drafts
  where input_hash = v_hash and status in ('draft','ready_for_review')
    and created_at >= now() - interval '10 minutes'
  order by created_at desc limit 1;
  if v_dup is not null then
    return public.admin_ai_pl_seq_detail(v_dup) || jsonb_build_object('duplicate', true);
  end if;

  insert into public.ai_playlist_sequence_drafts(
    playlist_draft_id, name, strategy, seed, algorithm_version,
    input_snapshot, constraint_snapshot, relaxations, energy_curve,
    explanation, warnings, insufficient_data, input_hash, created_by)
  values (
    v_draft_id, v_name, v_strategy,
    coalesce((p_payload->>'seed')::bigint, 1),
    coalesce(nullif(p_payload->>'algorithm_version',''), 'pl-seq-v1'),
    coalesce(p_payload->'input_snapshot', '{}'::jsonb),
    coalesce(p_payload->'constraint_snapshot', '{}'::jsonb),
    coalesce(p_payload->'relaxations', '[]'::jsonb),
    coalesce(p_payload->'energy_curve', '[]'::jsonb),
    coalesce(p_payload->'explanation', '[]'::jsonb),
    v_warn, coalesce(p_payload->'insufficient_data', '[]'::jsonb),
    v_hash, auth.uid())
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_order) loop
    insert into public.ai_playlist_sequence_tracks(
      sequence_draft_id, track_id, sequence_position, original_draft_order,
      transition_from_track_id, transition_score, energy_delta, bpm_delta,
      reasons, warnings, feature_snapshot)
    values (
      v_id, (v_item->>'track_id')::uuid, (v_item->>'sequence_position')::int,
      (v_item->>'original_draft_order')::int,
      nullif(v_item->>'transition_from_track_id','')::uuid,
      least(100, greatest(0, coalesce((v_item->>'transition_score')::numeric, 0))),
      (v_item->>'energy_delta')::numeric, (v_item->>'bpm_delta')::numeric,
      coalesce(v_item->'reasons', '[]'::jsonb), coalesce(v_item->'warnings', '[]'::jsonb),
      coalesce(v_item->'feature_snapshot', '{}'::jsonb));
  end loop;

  -- 서버 Quality 재계산(클라이언트 점수 무시) + Track Set/Hard 재검증 결과 반영.
  v_quality := public._ai_pl_seq_quality(v_id);
  if jsonb_array_length(v_quality->'hard_violations') > 0 then
    raise exception 'sequence_generation_failed: % (hard_constraint_conflict, manual_review_required)',
      v_quality->'hard_violations' using errcode = '23514';
  end if;
  update public.ai_playlist_sequence_drafts set
    quality_score = (v_quality->>'score')::numeric,
    quality_grade = v_quality->>'grade',
    quality_breakdown = v_quality->'breakdown',
    transition_summary = v_quality->'transition_summary'
  where id = v_id;

  insert into public.ai_playlist_sequence_events(sequence_draft_id, event_type, actor_id, next_status, metadata)
  values (v_id, 'created', auth.uid(), 'draft',
    jsonb_build_object('strategy', v_strategy, 'tracks', v_given, 'quality', v_quality->>'score'));

  return public.admin_ai_pl_seq_detail(v_id);
end;
$$;

grant execute on function public.admin_ai_pl_seq_create(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) 목록/상세/재평가/상태 전이 — Publish/Position Apply RPC 는 존재하지 않는다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_pl_seqs(p_status text default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit, 50), 200)); v_result jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_result
  from (
    select s.id, s.name, s.strategy, s.status, s.seed, s.playlist_draft_id,
      d.name as draft_name, s.quality_score, s.quality_grade,
      (s.transition_summary->>'avg_energy_delta') as avg_energy_delta,
      (select count(*) from public.ai_playlist_sequence_tracks st where st.sequence_draft_id = s.id) as track_count,
      s.algorithm_version, s.expires_at, s.created_at, s.reviewed_at,
      u.nickname as created_by_name, r.nickname as reviewed_by_name
    from public.ai_playlist_sequence_drafts s
    join public.ai_playlist_drafts d on d.id = s.playlist_draft_id
    left join public.users u on u.id = s.created_by
    left join public.users r on r.id = s.reviewed_by
    where p_status is null or s.status = p_status
    order by s.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_pl_seqs(text, int) to authenticated;

create or replace function public.admin_ai_pl_seq_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_seq jsonb; v_tracks jsonb; v_events jsonb;
begin
  perform public._admin_growth_guard();

  select to_jsonb(s) into v_seq from public.ai_playlist_sequence_drafts s where s.id = p_id;
  if v_seq is null then raise exception 'sequence not found: %', p_id using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.sequence_position), '[]'::jsonb) into v_tracks
  from (
    select st.track_id, st.sequence_position, st.original_draft_order, st.transition_from_track_id,
      st.transition_score, st.energy_delta, st.bpm_delta, st.reasons, st.warnings,
      tr.title, tr.artist, tr.album_name, tr.main_genre, tr.mood, tr.instrumental,
      af.energy, coalesce(af.bpm, tr.bpm) as bpm, af.vocal_presence
    from public.ai_playlist_sequence_tracks st
    left join public.tracks tr on tr.id = st.track_id
    left join public.track_audio_features af on af.track_id = st.track_id
    where st.sequence_draft_id = p_id
  ) t;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into v_events
  from (
    select ev.event_type, ev.actor_id, ev.previous_status, ev.next_status, ev.reason, ev.metadata, ev.created_at,
      u.nickname as actor_name
    from public.ai_playlist_sequence_events ev
    left join public.users u on u.id = ev.actor_id
    where ev.sequence_draft_id = p_id
    order by ev.created_at desc limit 50
  ) e;

  return jsonb_build_object('sequence', v_seq, 'tracks', v_tracks, 'events', v_events, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_pl_seq_detail(uuid) to authenticated;

create or replace function public.admin_ai_pl_seq_reevaluate(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_quality jsonb; v_status text;
begin
  perform public._admin_growth_guard();
  select status into v_status from public.ai_playlist_sequence_drafts where id = p_id;
  if v_status is null then raise exception 'sequence not found: %', p_id using errcode = 'P0002'; end if;

  v_quality := public._ai_pl_seq_quality(p_id);
  update public.ai_playlist_sequence_drafts set
    quality_score = (v_quality->>'score')::numeric,
    quality_grade = v_quality->>'grade',
    quality_breakdown = v_quality->'breakdown',
    transition_summary = v_quality->'transition_summary'
  where id = p_id;

  insert into public.ai_playlist_sequence_events(sequence_draft_id, event_type, actor_id, metadata)
  values (p_id, 'reevaluated', auth.uid(),
    jsonb_build_object('quality', v_quality->>'score', 'grade', v_quality->>'grade',
      'hard_violations', v_quality->'hard_violations'));

  return public.admin_ai_pl_seq_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_pl_seq_reevaluate(uuid) to authenticated;

create or replace function public.admin_ai_pl_seq_set_status(p_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare s record; v_allowed boolean; v_quality jsonb;
begin
  perform public._admin_growth_guard();

  select * into s from public.ai_playlist_sequence_drafts where id = p_id;
  if s.id is null then raise exception 'sequence not found: %', p_id using errcode = 'P0002'; end if;

  if p_status not in ('draft','ready_for_review','approved','rejected','expired','archived') then
    raise exception 'invalid status: %', p_status using errcode = '22023';
  end if;

  v_allowed := (s.status = 'draft' and p_status in ('ready_for_review','archived'))
    or (s.status = 'ready_for_review' and p_status in ('approved','rejected','draft','archived'))
    or (s.status in ('approved','rejected') and p_status = 'archived')
    or (p_status = 'expired' and now() > s.expires_at);
  if not v_allowed then
    raise exception 'transition not allowed: % -> %', s.status, p_status using errcode = '22023';
  end if;

  if p_status = 'ready_for_review' then
    v_quality := public._ai_pl_seq_quality(p_id);
    if jsonb_array_length(v_quality->'hard_violations') > 0 then
      raise exception 'hard violations block review: %', v_quality->'hard_violations' using errcode = '23514';
    end if;
    update public.ai_playlist_sequence_drafts set
      quality_score = (v_quality->>'score')::numeric, quality_grade = v_quality->>'grade',
      quality_breakdown = v_quality->'breakdown', transition_summary = v_quality->'transition_summary'
    where id = p_id;
  end if;

  if p_status = 'rejected' and coalesce(p_reason,'') = '' then
    raise exception 'rejection_reason required' using errcode = '22023';
  end if;

  update public.ai_playlist_sequence_drafts set
    status = p_status,
    reviewed_by = case when p_status in ('approved','rejected') then auth.uid() else reviewed_by end,
    reviewed_at = case when p_status in ('approved','rejected') then now() else reviewed_at end,
    rejection_reason = case when p_status = 'rejected' then p_reason else rejection_reason end
  where id = p_id;

  insert into public.ai_playlist_sequence_events(sequence_draft_id, event_type, actor_id, previous_status, next_status, reason)
  values (p_id, 'status_changed', auth.uid(), s.status, p_status, p_reason);

  return public.admin_ai_pl_seq_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_pl_seq_set_status(uuid, text, text) to authenticated;
