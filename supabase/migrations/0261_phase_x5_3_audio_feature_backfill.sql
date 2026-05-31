-- 0261 — Phase X5.3 Audio Feature Backfill Engine
--
-- 목표:
--   1) track_audio_features.valence 컬럼 추가
--   2) track_genre_audio_priors 테이블 (16 장르 × 5 dimensions 학습 데이터)
--   3) derive_track_analysis 버그 수정 (energy_level NULL → 60 고정 → genre prior 사용)
--   4) _estimate_track_audio_features — main_genre + mood + instrumental heuristic
--   5) admin_backfill_audio_features — bulk RPC (analyzer 충돌 보존)
--   6) tracks AFTER INSERT trigger — 신규 업로드 자동 backfill
--
-- 정책:
--   - 기존 analyzer != 'heuristic_v1' (실분석) 값은 보존
--   - heuristic_v1 추정값은 raw_features.source='heuristic_v1' 표시
--   - X5.2 store profile 평가 시 fallback chain: af > ta > tracks.instrumental boolean

-- ===== A. valence 컬럼 추가 =====
alter table public.track_audio_features
  add column if not exists valence numeric;

-- ===== B. track_genre_audio_priors (학습 reference) =====
create table if not exists public.track_genre_audio_priors (
  main_genre        text primary key,
  energy            numeric not null,
  instrumentalness  numeric not null,
  acousticness      numeric not null,
  speechiness       numeric not null,
  danceability      numeric not null,
  valence           numeric not null,
  sample_size       int not null,
  source            text not null default 'reference_n200',
  updated_at        timestamptz not null default now()
);

-- 학습 reference: 기존 200개 track_audio_features 의 main_genre × 평균
insert into public.track_genre_audio_priors
  (main_genre, energy, instrumentalness, acousticness, speechiness, danceability, valence, sample_size)
values
  ('POP',         0.587, 0.353, 0.575, 0.10, 0.650, 0.65, 57),
  ('Indie Pop',   0.621, 0.446, 0.651, 0.08, 0.670, 0.62, 32),
  ('K-POP',       0.472, 0.397, 0.483, 0.09, 0.599, 0.60, 25),
  ('J-Pop',       0.695, 0.273, 0.553, 0.10, 0.684, 0.70, 15),
  ('Alternative', 0.481, 0.380, 0.545, 0.08, 0.603, 0.55, 15),
  ('Ambient',     0.854, 0.389, 0.552, 0.04, 0.752, 0.55, 14),
  ('Lo-fi',       0.412, 0.357, 0.944, 0.05, 0.577, 0.50, 10),
  ('K-R&B',       0.856, 0.336, 0.513, 0.10, 0.768, 0.55, 9),
  ('City Pop',    0.459, 0.395, 0.555, 0.08, 0.589, 0.65, 6),
  ('Disco',       0.589, 0.650, 0.329, 0.06, 0.653, 0.75, 4),
  ('Electronic',  0.867, 0.429, 0.470, 0.05, 0.752, 0.65, 4),
  ('Retro Pop',   0.541, 0.583, 0.394, 0.07, 0.630, 0.70, 3),
  ('Anime',       0.421, 0.288, 0.494, 0.10, 0.577, 0.55, 3),
  ('J-Rock',      0.495, 0.379, 0.461, 0.09, 0.591, 0.50, 1),
  ('Jazz',        0.492, 0.605, 0.544, 0.05, 0.590, 0.55, 1),
  ('Jazzhop',     0.479, 0.466, 0.712, 0.05, 0.643, 0.55, 1),
  -- 신규 추정 (referencing 데이터에 없는 장르)
  ('Rock',        0.75,  0.30,  0.30,  0.08, 0.55,  0.55, 0),
  ('Hard Rock',   0.85,  0.20,  0.15,  0.08, 0.50,  0.55, 0),
  ('Metal',       0.92,  0.30,  0.10,  0.07, 0.50,  0.50, 0),
  ('Punk',        0.88,  0.20,  0.15,  0.10, 0.55,  0.55, 0),
  ('HipHop',      0.65,  0.05,  0.20,  0.30, 0.75,  0.55, 0),
  ('K-HipHop',    0.65,  0.05,  0.20,  0.30, 0.75,  0.55, 0),
  ('Hip-Hop',     0.65,  0.05,  0.20,  0.30, 0.75,  0.55, 0),
  ('R&B',         0.50,  0.20,  0.45,  0.10, 0.65,  0.55, 0),
  ('Ballad',      0.35,  0.30,  0.70,  0.05, 0.45,  0.40, 0),
  ('Piano',       0.30,  0.90,  0.85,  0.03, 0.40,  0.50, 0),
  ('Classical',   0.30,  0.95,  0.92,  0.03, 0.35,  0.45, 0),
  ('Cafe Music',  0.45,  0.60,  0.75,  0.05, 0.55,  0.60, 0),
  ('Bossa Nova',  0.40,  0.45,  0.75,  0.05, 0.65,  0.65, 0),
  ('Lounge',      0.40,  0.50,  0.55,  0.05, 0.60,  0.55, 0),
  ('Chillhop',    0.45,  0.55,  0.55,  0.07, 0.65,  0.55, 0),
  ('Latin',       0.70,  0.20,  0.45,  0.08, 0.80,  0.75, 0),
  ('Dubstep',     0.92,  0.40,  0.05,  0.07, 0.65,  0.50, 0),
  ('Hardstyle',   0.95,  0.30,  0.05,  0.05, 0.70,  0.50, 0),
  ('Phonk',       0.88,  0.20,  0.15,  0.15, 0.75,  0.55, 0)
on conflict (main_genre) do update set
  energy=excluded.energy, instrumentalness=excluded.instrumentalness,
  acousticness=excluded.acousticness, speechiness=excluded.speechiness,
  danceability=excluded.danceability, valence=excluded.valence,
  sample_size=excluded.sample_size, updated_at=now();

-- Global default (장르 매칭 실패 시)
insert into public.track_genre_audio_priors
  (main_genre, energy, instrumentalness, acousticness, speechiness, danceability, valence, sample_size)
values ('__GLOBAL_DEFAULT__', 0.55, 0.35, 0.55, 0.08, 0.60, 0.55, 0)
on conflict (main_genre) do nothing;

-- ===== C. _estimate_track_audio_features (heuristic) =====
create or replace function public._estimate_track_audio_features(p_track_id uuid)
returns table (
  energy           numeric,
  instrumentalness numeric,
  acousticness     numeric,
  speechiness      numeric,
  danceability     numeric,
  valence          numeric,
  confidence       numeric
)
language plpgsql
stable parallel safe
as $$
declare
  t record;
  prior record;
  v_energy numeric; v_instr numeric; v_acoust numeric;
  v_speech numeric; v_dance numeric; v_valence numeric;
  v_conf numeric := 0.5;  -- heuristic base confidence
  v_mood_low text;
begin
  select main_genre, mood, mood_tags, instrumental, energy_level
    into t from public.tracks where id = p_track_id;
  if t.main_genre is null then return; end if;

  -- 1) main_genre prior lookup (case-insensitive)
  select * into prior from public.track_genre_audio_priors
    where lower(main_genre) = lower(t.main_genre) limit 1;
  if prior.main_genre is null then
    select * into prior from public.track_genre_audio_priors
      where main_genre='__GLOBAL_DEFAULT__';
    v_conf := 0.3;
  elsif prior.sample_size >= 5 then
    v_conf := 0.7;
  else
    v_conf := 0.4;
  end if;

  v_energy  := prior.energy;
  v_instr   := prior.instrumentalness;
  v_acoust  := prior.acousticness;
  v_speech  := prior.speechiness;
  v_dance   := prior.danceability;
  v_valence := prior.valence;

  -- 2) instrumental boolean 조정 (강한 신호)
  if t.instrumental = true then
    v_instr  := greatest(v_instr, 0.85);
    v_speech := least(v_speech, 0.05);
    v_acoust := greatest(v_acoust, 0.40);
  else
    v_speech := greatest(v_speech, 0.06);
  end if;

  -- 3) mood 조정 (mood text + mood_tags)
  v_mood_low := lower(coalesce(t.mood, '') || ' ' ||
                      coalesce(array_to_string(t.mood_tags, ' '), ''));
  if v_mood_low ~* '(잔잔|편안|차분|calm|peaceful|relax)' then
    v_energy  := least(v_energy, 0.45);
    v_acoust  := least(1, v_acoust + 0.10);
  end if;
  if v_mood_low ~* '(활기|에너지|운동|energetic|upbeat|업|hyped|파워)' then
    v_energy := least(1, v_energy + 0.15);
    v_dance  := least(1, v_dance + 0.10);
  end if;
  if v_mood_low ~* '(슬프|우울|sad|melancho|blue)' then
    v_valence := least(v_valence, 0.30);
    v_energy  := least(v_energy, 0.50);
  end if;
  if v_mood_low ~* '(밝은|행복|happy|joyful|기쁨)' then
    v_valence := greatest(v_valence, 0.75);
  end if;
  if v_mood_low ~* '(트렌디|trendy|모던)' then
    v_speech := greatest(v_speech, 0.10);
  end if;

  -- 4) tracks.energy_level (1-5) override — 신뢰도 높음
  if t.energy_level is not null then
    v_energy := least(1, greatest(0, t.energy_level::numeric / 5));
    v_conf := greatest(v_conf, 0.6);
  end if;

  energy           := round(greatest(0, least(1, v_energy)),  3);
  instrumentalness := round(greatest(0, least(1, v_instr)),   3);
  acousticness     := round(greatest(0, least(1, v_acoust)),  3);
  speechiness      := round(greatest(0, least(1, v_speech)),  3);
  danceability    := round(greatest(0, least(1, v_dance)),    3);
  valence          := round(greatest(0, least(1, v_valence)), 3);
  confidence       := v_conf;
  return next;
end; $$;

-- ===== D. derive_track_analysis 버그 수정 =====
-- energy_level NULL → 무조건 60 → audio_features 또는 genre prior 사용
create or replace function public.derive_track_analysis(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  af record;
  est record;
  v_energy int;
  v_dance int;
  v_valence int;
  v_instr int;
  v_vocal int;
begin
  select * into t from public.tracks where id = p_track_id;
  if t.id is null then return; end if;

  -- 1순위: track_audio_features (실분석)
  select energy, instrumentalness, acousticness, speechiness, danceability, valence
    into af from public.track_audio_features where track_id = p_track_id;

  if af.energy is not null then
    v_energy   := round(af.energy * 100);
    v_dance    := round(coalesce(af.danceability, 0.5) * 100);
    v_valence  := round(coalesce(af.valence, 0.5) * 100);
    v_instr    := round(coalesce(af.instrumentalness, 0.5) * 100);
    v_vocal    := round((1 - coalesce(af.instrumentalness, 0.5)) * 100);
  else
    -- 2순위: tracks.energy_level (사용자 입력)
    if t.energy_level is not null then
      v_energy := least(100, greatest(0, t.energy_level * 20));
    else
      -- 3순위: heuristic 추정
      select * into est from public._estimate_track_audio_features(p_track_id);
      if est.energy is not null then
        v_energy  := round(est.energy * 100);
        v_dance   := round(est.danceability * 100);
        v_valence := round(est.valence * 100);
        v_instr   := round(est.instrumentalness * 100);
        v_vocal   := round((1 - est.instrumentalness) * 100);
      else
        -- 최후: 옛 default
        v_energy := 60; v_dance := 60; v_valence := 60;
        v_instr := case when coalesce(t.instrumental,false) then 90 else 20 end;
        v_vocal := 100 - v_instr;
      end if;
    end if;
    -- v_dance/valence/instr fallback (energy_level path 도착 시)
    if v_dance is null then v_dance := v_energy; end if;
    if v_valence is null then v_valence := v_energy; end if;
    if v_instr is null then
      v_instr := case when coalesce(t.instrumental,false) then 90 else 20 end;
    end if;
    if v_vocal is null then v_vocal := 100 - v_instr; end if;
  end if;

  insert into public.track_analysis as a
    (track_id, genre, bpm, mood_tags, energy, danceability, valence,
     vocal_presence, instrumentalness, loudness, duration, quality_score, analyzed_at)
  values (
    t.id,
    nullif(btrim(coalesce(t.main_genre, '')), ''),
    t.bpm,
    case when coalesce(array_length(t.mood_tags,1),0) > 0 then t.mood_tags
         when nullif(btrim(coalesce(t.mood,'')),'') is not null then array[t.mood]
         else '{}'::text[] end,
    v_energy, v_dance, v_valence, v_vocal, v_instr,
    null, t.duration,
    70 + case when t.duration between 60 and 420 then 10 else 0 end,
    now())
  on conflict (track_id) do update set
    genre=excluded.genre, bpm=excluded.bpm, mood_tags=excluded.mood_tags, energy=excluded.energy,
    danceability=excluded.danceability, valence=excluded.valence, vocal_presence=excluded.vocal_presence,
    instrumentalness=excluded.instrumentalness, duration=excluded.duration, quality_score=excluded.quality_score,
    analyzed_at=now();
end; $$;

-- ===== E. backfill_track_audio_features (track 1건) =====
create or replace function public.backfill_track_audio_features(
  p_track_id uuid,
  p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  af record;
  est record;
  v_action text;
begin
  select * into af from public.track_audio_features where track_id = p_track_id;

  -- 이미 실분석 값이 있고 force=false 면 skip
  if af.track_id is not null and not p_force
     and af.analyzer is not null and af.analyzer <> 'heuristic_v1'
     and af.energy is not null then
    return jsonb_build_object('action','skipped_real_analysis','analyzer', af.analyzer);
  end if;

  select * into est from public._estimate_track_audio_features(p_track_id);
  if est.energy is null then
    return jsonb_build_object('action','skipped_no_genre');
  end if;

  if af.track_id is null then
    insert into public.track_audio_features
      (track_id, energy, instrumentalness, acousticness, speechiness, danceability, valence,
       analyzer, analysis_version, status, analyzed_at,
       raw_features)
    values
      (p_track_id, est.energy, est.instrumentalness, est.acousticness, est.speechiness, est.danceability, est.valence,
       'heuristic_v1', 'x5.3', 'done', now(),
       jsonb_build_object('source','heuristic_v1','confidence', est.confidence));
    v_action := 'inserted_heuristic';
  else
    -- 기존 행이지만 heuristic 또는 NULL 인 경우만 갱신
    update public.track_audio_features set
      energy           = coalesce(case when analyzer='heuristic_v1' or p_force then est.energy else energy end, est.energy),
      instrumentalness = coalesce(case when analyzer='heuristic_v1' or p_force then est.instrumentalness else instrumentalness end, est.instrumentalness),
      acousticness     = coalesce(case when analyzer='heuristic_v1' or p_force then est.acousticness else acousticness end, est.acousticness),
      speechiness      = coalesce(case when analyzer='heuristic_v1' or p_force then est.speechiness else speechiness end, est.speechiness),
      danceability     = coalesce(case when analyzer='heuristic_v1' or p_force then est.danceability else danceability end, est.danceability),
      valence          = coalesce(case when analyzer='heuristic_v1' or p_force then est.valence else valence end, est.valence),
      analyzer         = case when analyzer is null or analyzer='heuristic_v1' or p_force then 'heuristic_v1' else analyzer end,
      analysis_version = case when analyzer is null or analyzer='heuristic_v1' or p_force then 'x5.3' else analysis_version end,
      status           = case when status is null or status='pending' or status='analyzing' then 'done' else status end,
      analyzed_at      = case when analyzer is null or analyzer='heuristic_v1' or p_force then now() else analyzed_at end,
      updated_at       = now(),
      raw_features     = case when analyzer is null or analyzer='heuristic_v1' or p_force
                              then jsonb_build_object('source','heuristic_v1','confidence', est.confidence)
                              else raw_features end
    where track_id = p_track_id;
    v_action := 'updated_heuristic';
  end if;

  -- track_analysis 도 재계산 (energy=60 버그 fix)
  perform public.derive_track_analysis(p_track_id);

  return jsonb_build_object(
    'action', v_action,
    'energy', est.energy, 'instr', est.instrumentalness,
    'acoust', est.acousticness, 'speech', est.speechiness,
    'dance', est.danceability, 'valence', est.valence,
    'confidence', est.confidence
  );
end; $$;

-- ===== F. admin_backfill_audio_features (bulk RPC) =====
create or replace function public.admin_backfill_audio_features(
  p_limit int default null,
  p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  r record;
  n_inserted int := 0; n_updated int := 0; n_skipped int := 0; n_no_genre int := 0;
  v_result jsonb;
  v_processed int := 0;
  v_started timestamptz := now();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  for r in
    select t.id from public.tracks t
    where t.main_genre is not null
    order by
      -- 우선순위: af 없음 > heuristic > 실분석 (force 일 때만)
      case when not exists (select 1 from public.track_audio_features af where af.track_id=t.id) then 0
           when exists (select 1 from public.track_audio_features af where af.track_id=t.id and af.analyzer='heuristic_v1') then 1
           else 2 end,
      t.created_at
    limit coalesce(p_limit, 999999)
  loop
    v_result := public.backfill_track_audio_features(r.id, p_force);
    v_processed := v_processed + 1;
    case v_result->>'action'
      when 'inserted_heuristic' then n_inserted := n_inserted + 1;
      when 'updated_heuristic' then n_updated := n_updated + 1;
      when 'skipped_real_analysis' then n_skipped := n_skipped + 1;
      when 'skipped_no_genre' then n_no_genre := n_no_genre + 1;
      else null;
    end case;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'inserted_heuristic', n_inserted,
    'updated_heuristic', n_updated,
    'skipped_real_analysis', n_skipped,
    'skipped_no_genre', n_no_genre,
    'elapsed_ms', extract(epoch from (now() - v_started))*1000
  );
end; $$;

-- ===== G. AFTER INSERT TRIGGER (신규 업로드 자동 backfill) =====
create or replace function public.tg_tracks_auto_backfill_af()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- main_genre 있고 audio_features 없으면 heuristic backfill
  if new.main_genre is not null
     and not exists (select 1 from public.track_audio_features af where af.track_id = new.id)
  then
    begin
      perform public.backfill_track_audio_features(new.id, false);
    exception when others then null;  -- 실패해도 INSERT 자체는 통과
    end;
  end if;
  return new;
end; $$;

drop trigger if exists tg_tracks_auto_backfill_af on public.tracks;
create trigger tg_tracks_auto_backfill_af
  after insert on public.tracks
  for each row execute function public.tg_tracks_auto_backfill_af();

-- ===== H. 권한 =====
revoke all on function public._estimate_track_audio_features(uuid) from public, anon;
revoke all on function public.backfill_track_audio_features(uuid, boolean) from public, anon;
revoke all on function public.admin_backfill_audio_features(int, boolean) from public, anon;
grant execute on function public._estimate_track_audio_features(uuid) to authenticated, service_role;
grant execute on function public.backfill_track_audio_features(uuid, boolean) to authenticated, service_role;
grant execute on function public.admin_backfill_audio_features(int, boolean) to authenticated, service_role;
