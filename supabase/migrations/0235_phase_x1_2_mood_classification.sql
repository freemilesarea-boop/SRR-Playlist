-- 0235 — Phase X1.2 CLAP zero-shot Mood 분류 인프라
--
-- X1.1 (genre) 패턴 재사용 + mood 특화:
--   - multi-select (top1~3 저장)
--   - 기존 predicted_main_genre / sub_genres / genre_confidence 보존 (덮어쓰지 않음)
--   - prediction_scores.mood 채움, .genre 는 보존
--
-- 적용 (1-click):
--   tracks.mood     = first(predicted_moods) 의 taxonomy_moods.name_ko
--   tracks.mood_tags = predicted_moods 의 name_ko 배열

-- ===== 1. store_track_mood_prediction =====
create or replace function public.store_track_mood_prediction(
  p_track_id uuid,
  p_predicted_moods text[],
  p_mood_confidence numeric,
  p_prediction_scores jsonb,         -- {"mood": {slug: score, ...}}
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
    predicted_moods, mood_confidence, prediction_scores
  )
  values (
    p_track_id, p_model_version,
    p_predicted_moods, p_mood_confidence, p_prediction_scores
  )
  on conflict (track_id, model_version) do update set
    predicted_moods   = excluded.predicted_moods,
    mood_confidence   = excluded.mood_confidence,
    -- prediction_scores 의 .mood 키만 머지 — .genre 등 다른 키는 보존
    prediction_scores = coalesce(track_ai_predictions.prediction_scores, '{}'::jsonb)
                        || jsonb_build_object('mood', excluded.prediction_scores->'mood');
end;
$$;
revoke all on function public.store_track_mood_prediction(uuid, text[], numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.store_track_mood_prediction(uuid, text[], numeric, jsonb, text) to service_role;

-- ===== 2. 후보 조회 (mood 미예측 트랙) =====
create or replace function public.list_tracks_needing_mood_classification(p_limit int default 50)
returns table (track_id uuid, title text, audio_url text, duration numeric, mood text)
language sql
security definer
set search_path = public
stable
as $$
  select t.id, t.title, t.audio_url, t.duration, t.mood
  from public.tracks t
  left join public.track_ai_predictions p
    on p.track_id = t.id and p.model_version = 'taxonomy-v1'
  where t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.removed_at is null
    and (p.id is null or p.predicted_moods is null or array_length(p.predicted_moods, 1) is null)
  order by t.created_at desc
  limit p_limit;
$$;
revoke all on function public.list_tracks_needing_mood_classification(int) from public, anon, authenticated;
grant execute on function public.list_tracks_needing_mood_classification(int) to service_role;

create or replace function public.count_tracks_needing_mood_classification()
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
    and (p.id is null or p.predicted_moods is null or array_length(p.predicted_moods, 1) is null);
$$;
grant execute on function public.count_tracks_needing_mood_classification() to authenticated, service_role;

-- ===== 3. Admin UI — 비교 list =====
create or replace function public.admin_list_mood_predictions(
  p_limit int default 50, p_offset int default 0,
  p_filter text default 'all'   -- 'all' | 'mismatch' | 'unapplied'
)
returns table (
  track_id uuid, title text, artist text, cover_url text,
  current_mood text, current_mood_tags text[],
  predicted_mood_slugs text[],
  predicted_mood_labels text[],
  mood_confidence numeric,
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
      t.id as track_id, t.title, t.artist, t.cover_url,
      t.mood as current_mood, t.mood_tags as current_mood_tags,
      p.predicted_moods as predicted_mood_slugs,
      p.mood_confidence, p.prediction_scores, p.applied_at, p.created_at as prediction_created_at
    from public.tracks t
    join public.track_ai_predictions p
      on p.track_id = t.id and p.model_version = 'taxonomy-v1'
    where t.removed_at is null
      and p.predicted_moods is not null and array_length(p.predicted_moods, 1) > 0
  ),
  with_labels as (
    select
      b.*,
      (
        select array_agg(coalesce(g.name_ko, sub.slug) order by ordinality)
        from unnest(b.predicted_mood_slugs) with ordinality as sub(slug, ordinality)
        left join public.taxonomy_moods g on g.slug = sub.slug
      ) as predicted_mood_labels
    from base b
  )
  select
    w.track_id, w.title, w.artist, w.cover_url,
    w.current_mood, w.current_mood_tags,
    w.predicted_mood_slugs, w.predicted_mood_labels,
    w.mood_confidence, w.prediction_scores, w.applied_at, w.prediction_created_at
  from with_labels w
  where (
    p_filter = 'all'
    or (p_filter = 'mismatch' and (
        w.current_mood is null
        or (w.predicted_mood_labels is not null and array_length(w.predicted_mood_labels, 1) > 0
            and w.current_mood <> w.predicted_mood_labels[1])
    ))
    or (p_filter = 'unapplied' and w.applied_at is null)
  )
  order by w.prediction_created_at desc
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.admin_list_mood_predictions(int, int, text) from public, anon;
grant execute on function public.admin_list_mood_predictions(int, int, text) to authenticated, service_role;

-- ===== 4. 1-click 적용: predicted_moods → tracks.mood + tracks.mood_tags =====
create or replace function public.admin_apply_ai_mood_to_track(p_track_id uuid)
returns table (track_id uuid, applied_mood text, applied_mood_tags text[], previous_mood text, previous_mood_tags text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_pred record;
  v_top_mood text;
  v_all_moods text[];
  v_prev_mood text;
  v_prev_tags text[];
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  select p.predicted_moods into v_pred
  from public.track_ai_predictions p
  where p.track_id = p_track_id and p.model_version = 'taxonomy-v1'
    and p.predicted_moods is not null and array_length(p.predicted_moods, 1) > 0;
  if not found then
    raise exception 'no taxonomy-v1 mood prediction for track %', p_track_id;
  end if;

  -- predicted slugs → name_ko (순서 유지)
  select array_agg(coalesce(g.name_ko, sub.slug) order by ordinality)
    into v_all_moods
  from unnest(v_pred.predicted_moods) with ordinality as sub(slug, ordinality)
  left join public.taxonomy_moods g on g.slug = sub.slug;

  v_top_mood := v_all_moods[1];

  select t.mood, t.mood_tags into v_prev_mood, v_prev_tags
  from public.tracks t where t.id = p_track_id;

  update public.tracks set mood = v_top_mood, mood_tags = v_all_moods where id = p_track_id;
  update public.track_ai_predictions
    set applied_at = now(), applied_by = v_admin
    where track_id = p_track_id and model_version = 'taxonomy-v1';

  return query select p_track_id, v_top_mood, v_all_moods, v_prev_mood, v_prev_tags;
end;
$$;
revoke all on function public.admin_apply_ai_mood_to_track(uuid) from public, anon;
grant execute on function public.admin_apply_ai_mood_to_track(uuid) to authenticated, service_role;

-- ===== 5. 통계 =====
create or replace function public.admin_mood_classification_status()
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
    where model_version = 'taxonomy-v1'
      and predicted_moods is not null and array_length(predicted_moods, 1) > 0
  ),
  p as (
    select count(*) as tracks_pending
    from public.tracks tr
    left join public.track_ai_predictions r
      on r.track_id = tr.id and r.model_version = 'taxonomy-v1'
    where tr.audio_url is not null and tr.removed_at is null
      and (r.id is null or r.predicted_moods is null or array_length(r.predicted_moods, 1) is null)
  ),
  a as (
    select count(*) as tracks_applied
    from public.track_ai_predictions
    where model_version = 'taxonomy-v1'
      and applied_at is not null
      and predicted_moods is not null and array_length(predicted_moods, 1) > 0
  ),
  m as (
    select count(*) as tracks_mismatch
    from public.tracks tr
    join public.track_ai_predictions pr
      on pr.track_id = tr.id and pr.model_version = 'taxonomy-v1'
    where pr.predicted_moods is not null and array_length(pr.predicted_moods, 1) > 0
      and (tr.mood is null or
           tr.mood <> (select coalesce(g.name_ko, pr.predicted_moods[1])
                       from public.taxonomy_moods g where g.slug = pr.predicted_moods[1]))
  )
  select t.tracks_total, c.tracks_classified, p.tracks_pending, a.tracks_applied, m.tracks_mismatch
  from t, c, p, a, m;
$$;
revoke all on function public.admin_mood_classification_status() from public, anon;
grant execute on function public.admin_mood_classification_status() to authenticated, service_role;
