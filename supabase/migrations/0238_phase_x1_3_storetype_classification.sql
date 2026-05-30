-- 0238 — Phase X1.3 CLAP zero-shot Store Type 분류 인프라
--
-- X1.1 (genre) / X1.2.3 (mood) 와 같은 taxonomy-v1 row 에 공존.
-- predicted_store_types text[] 에 top1~3 저장.
-- jsonb 부분 머지 → genre/mood 데이터 보존.
--
-- 적용 (1-click):
--   tracks.suitable_store = first(predicted_store_types) 의 taxonomy_store_types.name_ko

-- ===== 1. store_track_storetype_prediction =====
create or replace function public.store_track_storetype_prediction(
  p_track_id uuid,
  p_predicted_store_types text[],
  p_store_type_confidence numeric,
  p_prediction_scores jsonb,         -- {"store_type": {slug: score, ...}}
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
    predicted_store_types, store_type_confidence, prediction_scores
  )
  values (
    p_track_id, p_model_version,
    p_predicted_store_types, p_store_type_confidence, p_prediction_scores
  )
  on conflict (track_id, model_version) do update set
    predicted_store_types  = excluded.predicted_store_types,
    store_type_confidence  = excluded.store_type_confidence,
    -- prediction_scores 의 .store_type 키만 머지 — .genre, .mood 보존
    prediction_scores      = coalesce(track_ai_predictions.prediction_scores, '{}'::jsonb)
                              || jsonb_build_object('store_type', excluded.prediction_scores->'store_type');
end;
$$;
revoke all on function public.store_track_storetype_prediction(uuid, text[], numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.store_track_storetype_prediction(uuid, text[], numeric, jsonb, text) to service_role;

-- ===== 2. 후보 조회 =====
create or replace function public.list_tracks_needing_storetype_classification(p_limit int default 50)
returns table (track_id uuid, title text, audio_url text, duration numeric, suitable_store text)
language sql
security definer
set search_path = public
stable
as $$
  select t.id, t.title, t.audio_url, t.duration, t.suitable_store
  from public.tracks t
  left join public.track_ai_predictions p
    on p.track_id = t.id and p.model_version = 'taxonomy-v1'
  where t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.removed_at is null
    and (p.id is null or p.predicted_store_types is null or array_length(p.predicted_store_types, 1) is null)
  order by t.created_at desc
  limit p_limit;
$$;
revoke all on function public.list_tracks_needing_storetype_classification(int) from public, anon, authenticated;
grant execute on function public.list_tracks_needing_storetype_classification(int) to service_role;

create or replace function public.count_tracks_needing_storetype_classification()
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
    and (p.id is null or p.predicted_store_types is null or array_length(p.predicted_store_types, 1) is null);
$$;
grant execute on function public.count_tracks_needing_storetype_classification() to authenticated, service_role;

-- ===== 3. Admin UI — 비교 list =====
create or replace function public.admin_list_storetype_predictions(
  p_limit int default 50, p_offset int default 0,
  p_filter text default 'all'   -- 'all' | 'mismatch' | 'unapplied'
)
returns table (
  track_id uuid, title text, artist text, cover_url text,
  current_suitable_store text,
  predicted_store_type_slugs text[],
  predicted_store_type_labels text[],
  store_type_confidence numeric,
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
      t.suitable_store as current_suitable_store,
      p.predicted_store_types as predicted_store_type_slugs,
      p.store_type_confidence, p.prediction_scores, p.applied_at, p.created_at as prediction_created_at
    from public.tracks t
    join public.track_ai_predictions p
      on p.track_id = t.id and p.model_version = 'taxonomy-v1'
    where t.removed_at is null
      and p.predicted_store_types is not null and array_length(p.predicted_store_types, 1) > 0
  ),
  with_labels as (
    select b.*,
      (select array_agg(coalesce(g.name_ko, sub.slug) order by ordinality)
       from unnest(b.predicted_store_type_slugs) with ordinality as sub(slug, ordinality)
       left join public.taxonomy_store_types g on g.slug = sub.slug) as predicted_store_type_labels
    from base b
  )
  select w.track_id, w.title, w.artist, w.cover_url,
    w.current_suitable_store,
    w.predicted_store_type_slugs, w.predicted_store_type_labels,
    w.store_type_confidence, w.prediction_scores, w.applied_at, w.prediction_created_at
  from with_labels w
  where (
    p_filter = 'all'
    or (p_filter = 'mismatch' and (
        w.current_suitable_store is null
        or (w.predicted_store_type_labels is not null and array_length(w.predicted_store_type_labels, 1) > 0
            and w.current_suitable_store <> w.predicted_store_type_labels[1])))
    or (p_filter = 'unapplied' and w.applied_at is null)
  )
  order by w.prediction_created_at desc
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.admin_list_storetype_predictions(int, int, text) from public, anon;
grant execute on function public.admin_list_storetype_predictions(int, int, text) to authenticated, service_role;

-- ===== 4. 1-click 적용 =====
create or replace function public.admin_apply_ai_storetype_to_track(p_track_id uuid)
returns table (track_id uuid, applied_store text, previous_store text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_pred record;
  v_top_label text;
  v_prev_store text;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select p.predicted_store_types into v_pred
  from public.track_ai_predictions p
  where p.track_id = p_track_id and p.model_version = 'taxonomy-v1'
    and p.predicted_store_types is not null and array_length(p.predicted_store_types, 1) > 0;
  if not found then
    raise exception 'no taxonomy-v1 store_type prediction for track %', p_track_id;
  end if;

  select coalesce(g.name_ko, v_pred.predicted_store_types[1]) into v_top_label
  from public.taxonomy_store_types g where g.slug = v_pred.predicted_store_types[1];

  select t.suitable_store into v_prev_store from public.tracks t where t.id = p_track_id;

  update public.tracks set suitable_store = v_top_label where id = p_track_id;
  update public.track_ai_predictions
    set applied_at = now(), applied_by = v_admin
    where track_id = p_track_id and model_version = 'taxonomy-v1';

  return query select p_track_id, v_top_label, v_prev_store;
end;
$$;
revoke all on function public.admin_apply_ai_storetype_to_track(uuid) from public, anon;
grant execute on function public.admin_apply_ai_storetype_to_track(uuid) to authenticated, service_role;

-- ===== 5. 통계 =====
create or replace function public.admin_storetype_classification_status()
returns table (
  tracks_total bigint, tracks_classified bigint, tracks_pending bigint,
  tracks_applied bigint, tracks_mismatch bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with t as (select count(*) as tracks_total from public.tracks where audio_url is not null and removed_at is null),
  c as (select count(*) as tracks_classified from public.track_ai_predictions
        where model_version = 'taxonomy-v1' and predicted_store_types is not null and array_length(predicted_store_types, 1) > 0),
  p as (select count(*) as tracks_pending from public.tracks tr
        left join public.track_ai_predictions r on r.track_id = tr.id and r.model_version = 'taxonomy-v1'
        where tr.audio_url is not null and tr.removed_at is null
          and (r.id is null or r.predicted_store_types is null or array_length(r.predicted_store_types, 1) is null)),
  a as (select count(*) as tracks_applied from public.track_ai_predictions
        where model_version = 'taxonomy-v1' and applied_at is not null
          and predicted_store_types is not null and array_length(predicted_store_types, 1) > 0),
  m as (select count(*) as tracks_mismatch from public.tracks tr
        join public.track_ai_predictions pr on pr.track_id = tr.id and pr.model_version = 'taxonomy-v1'
        where pr.predicted_store_types is not null and array_length(pr.predicted_store_types, 1) > 0
          and (tr.suitable_store is null or tr.suitable_store <>
               (select coalesce(g.name_ko, pr.predicted_store_types[1])
                from public.taxonomy_store_types g where g.slug = pr.predicted_store_types[1])))
  select t.tracks_total, c.tracks_classified, p.tracks_pending, a.tracks_applied, m.tracks_mismatch
  from t, c, p, a, m;
$$;
revoke all on function public.admin_storetype_classification_status() from public, anon;
grant execute on function public.admin_storetype_classification_status() to authenticated, service_role;
