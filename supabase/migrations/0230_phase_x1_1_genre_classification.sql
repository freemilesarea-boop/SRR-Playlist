-- 0230 — Phase X1.1 CLAP zero-shot 장르 분류 인프라
--
-- Modal worker:
--   1. list_taxonomy_genres() (이미 0228) 로 활성 장르 슬러그 + name_en 수집
--   2. 트랙당 CLAP audio embedding 추출
--   3. 각 장르 3 prompts → text features → 평균 → 장르 text feature
--   4. cosine sim → softmax → top1/sub3 + 전체 분포
--   5. store_track_genre_prediction RPC 로 저장
--
-- 저장:
--   model_version = 'taxonomy-v1' 별도 행 (energy/bpm 의 'laion-clap-music-v1+librosa' 와 공존)
--   predicted_main_genre / sub_genres / genre_confidence / prediction_scores.genre
--
-- 적용 (1-click):
--   admin_apply_ai_genre_to_track(p_track_id)
--     → tracks.main_genre 에 predicted_main_genre 의 name_ko 를 복사

-- ===== 1. Modal worker 가 호출할 RPC =====

create or replace function public.store_track_genre_prediction(
  p_track_id uuid,
  p_predicted_main_genre text,
  p_predicted_sub_genres text[],
  p_genre_confidence numeric,
  p_prediction_scores jsonb,
  p_model_version text default 'taxonomy-v1'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.track_ai_predictions (
    track_id, model_version,
    predicted_main_genre, predicted_sub_genres, genre_confidence, prediction_scores
  )
  values (
    p_track_id, p_model_version,
    p_predicted_main_genre, p_predicted_sub_genres, p_genre_confidence, p_prediction_scores
  )
  on conflict (track_id, model_version) do update set
    predicted_main_genre = excluded.predicted_main_genre,
    predicted_sub_genres = excluded.predicted_sub_genres,
    genre_confidence     = excluded.genre_confidence,
    prediction_scores    = excluded.prediction_scores;
end;
$$;
revoke all on function public.store_track_genre_prediction(uuid, text, text[], numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.store_track_genre_prediction(uuid, text, text[], numeric, jsonb, text) to service_role;

-- 후보 조회: audio_url 있고 'taxonomy-v1' 행이 없는 트랙
create or replace function public.list_tracks_needing_genre_classification(p_limit int default 50)
returns table (track_id uuid, title text, audio_url text, duration numeric, main_genre text)
language sql
security definer
set search_path = public
stable
as $$
  select t.id, t.title, t.audio_url, t.duration, t.main_genre
  from public.tracks t
  left join public.track_ai_predictions p
    on p.track_id = t.id and p.model_version = 'taxonomy-v1'
  where t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.removed_at is null
    and (p.id is null or p.predicted_main_genre is null)
  order by t.created_at desc
  limit p_limit;
$$;
revoke all on function public.list_tracks_needing_genre_classification(int) from public, anon, authenticated;
grant execute on function public.list_tracks_needing_genre_classification(int) to service_role;

-- 후보 카운트
create or replace function public.count_tracks_needing_genre_classification()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(*)
  from public.tracks t
  left join public.track_ai_predictions p
    on p.track_id = t.id and p.model_version = 'taxonomy-v1'
  where t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.removed_at is null
    and (p.id is null or p.predicted_main_genre is null);
$$;
grant execute on function public.count_tracks_needing_genre_classification() to authenticated, service_role;

-- ===== 2. Admin UI 가 호출할 RPC =====

-- 예측 + 기존 메타 비교 list (페이지네이션)
create or replace function public.admin_list_genre_predictions(
  p_limit int default 50, p_offset int default 0,
  p_filter text default 'all'   -- 'all' | 'mismatch' | 'unapplied'
)
returns table (
  track_id uuid, title text, artist text, cover_url text,
  current_main_genre text,                 -- 기존 tracks.main_genre (artist 입력)
  predicted_main_genre_slug text,
  predicted_main_genre_label text,         -- taxonomy_genres.name_ko
  predicted_sub_genres text[],
  predicted_sub_labels text[],
  genre_confidence numeric,
  prediction_scores jsonb,
  applied_at timestamptz,
  prediction_created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  return query
  with base as (
    select
      t.id as track_id, t.title, t.artist, t.cover_url, t.main_genre as current_main_genre,
      p.predicted_main_genre as predicted_main_genre_slug,
      p.predicted_sub_genres,
      p.genre_confidence, p.prediction_scores, p.applied_at, p.created_at as prediction_created_at
    from public.tracks t
    join public.track_ai_predictions p
      on p.track_id = t.id and p.model_version = 'taxonomy-v1'
    where t.removed_at is null
      and p.predicted_main_genre is not null
  ),
  with_labels as (
    select
      b.*,
      (select g.name_ko from public.taxonomy_genres g where g.slug = b.predicted_main_genre_slug) as predicted_main_genre_label,
      (
        select array_agg(coalesce(g.name_ko, sub.slug) order by ordinality)
        from unnest(coalesce(b.predicted_sub_genres, '{}'::text[])) with ordinality as sub(slug, ordinality)
        left join public.taxonomy_genres g on g.slug = sub.slug
      ) as predicted_sub_labels
    from base b
  )
  select
    w.track_id, w.title, w.artist, w.cover_url, w.current_main_genre,
    w.predicted_main_genre_slug, w.predicted_main_genre_label,
    w.predicted_sub_genres, w.predicted_sub_labels,
    w.genre_confidence, w.prediction_scores, w.applied_at, w.prediction_created_at
  from with_labels w
  where (
    p_filter = 'all'
    or (p_filter = 'mismatch' and (
        w.current_main_genre is null
        or w.current_main_genre <> w.predicted_main_genre_label
    ))
    or (p_filter = 'unapplied' and w.applied_at is null)
  )
  order by w.prediction_created_at desc
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.admin_list_genre_predictions(int, int, text) from public, anon;
grant execute on function public.admin_list_genre_predictions(int, int, text) to authenticated, service_role;

-- 1-click 적용: AI 예측 장르 → tracks.main_genre (name_ko 로)
create or replace function public.admin_apply_ai_genre_to_track(p_track_id uuid)
returns table (track_id uuid, applied_genre text, previous_genre text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_pred record;
  v_label text;
  v_prev text;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  select p.predicted_main_genre, p.id into v_pred
  from public.track_ai_predictions p
  where p.track_id = p_track_id and p.model_version = 'taxonomy-v1'
    and p.predicted_main_genre is not null;
  if not found then
    raise exception 'no taxonomy-v1 genre prediction for track %', p_track_id;
  end if;

  select g.name_ko into v_label
  from public.taxonomy_genres g
  where g.slug = v_pred.predicted_main_genre;
  if v_label is null then
    raise exception 'taxonomy slug % not found in taxonomy_genres', v_pred.predicted_main_genre;
  end if;

  select t.main_genre into v_prev from public.tracks t where t.id = p_track_id;

  update public.tracks set main_genre = v_label where id = p_track_id;
  update public.track_ai_predictions
    set applied_at = now(), applied_by = v_admin
    where track_id = p_track_id and model_version = 'taxonomy-v1';

  return query select p_track_id, v_label, v_prev;
end;
$$;
revoke all on function public.admin_apply_ai_genre_to_track(uuid) from public, anon;
grant execute on function public.admin_apply_ai_genre_to_track(uuid) to authenticated, service_role;

-- 통계 (UI 상단)
create or replace function public.admin_genre_classification_status()
returns table (
  tracks_total bigint,
  tracks_classified bigint,
  tracks_pending bigint,
  tracks_applied bigint,
  tracks_mismatch bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with t as (
    select count(*) as tracks_total from public.tracks
    where audio_url is not null and removed_at is null
  ),
  c as (
    select count(*) as tracks_classified
    from public.track_ai_predictions
    where model_version = 'taxonomy-v1' and predicted_main_genre is not null
  ),
  p as (
    select count(*) as tracks_pending
    from public.tracks tr
    left join public.track_ai_predictions r
      on r.track_id = tr.id and r.model_version = 'taxonomy-v1'
    where tr.audio_url is not null and tr.removed_at is null
      and (r.id is null or r.predicted_main_genre is null)
  ),
  a as (
    select count(*) as tracks_applied
    from public.track_ai_predictions
    where model_version = 'taxonomy-v1' and applied_at is not null
  ),
  m as (
    select count(*) as tracks_mismatch
    from public.tracks tr
    join public.track_ai_predictions pr
      on pr.track_id = tr.id and pr.model_version = 'taxonomy-v1'
    left join public.taxonomy_genres g on g.slug = pr.predicted_main_genre
    where pr.predicted_main_genre is not null
      and (tr.main_genre is null or tr.main_genre <> g.name_ko)
  )
  select t.tracks_total, c.tracks_classified, p.tracks_pending, a.tracks_applied, m.tracks_mismatch
  from t, c, p, a, m;
$$;
revoke all on function public.admin_genre_classification_status() from public, anon;
grant execute on function public.admin_genre_classification_status() to authenticated, service_role;
