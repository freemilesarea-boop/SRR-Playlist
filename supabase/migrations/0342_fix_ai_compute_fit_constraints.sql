-- 0342 — Hotfix: _ai_compute_fit (X6.70/0337 재정의 회귀) — source/status check 위반
--
-- 문제:
--   0337 (Phase 4c) 에서 _ai_compute_fit 재정의하면서:
--     - source='ai_v2.2' (CHECK: algorithm|admin|user_behavior)
--     - status='recommend'/'low'/'neutral' (CHECK: active|excluded|review_needed)
--   사용 → playlist_track_fit_scores INSERT 시 check_constraint violation.
--
--   X6.75 (0341 daily playlist refresh) cron 첫 실행 시 12/12 플리 전부 실패로 발견.
--   0337 머지 후 ~ X6.75 머지 전까지 fit_score 재계산 시도가 모두 silent fail 되어
--   기존 데이터에 변화 없음 (다행히).
--
-- 수정:
--   0241 의 원본 값으로 복귀 (source='algorithm', status='active|review_needed|excluded')
--   + 0337 에서 추가한 segment-weight resolver (v_w) 유지 (Phase 4c 핵심 기능).

create or replace function public._ai_compute_fit(p_playlist_id uuid, p_track_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  pl record; ai record; t record; cfg record; gr jsonb; pred record;
  v_key text; v_audio numeric; v_meta numeric; v_behav numeric; v_pen numeric;
  v_manual numeric; v_fit numeric;
  v_status text; v_reason text; v_excluded boolean := false; v_gpen numeric := 0;
  v_normalized_slug text;
  v_ai_genre int := 0; v_ai_mood int := 0; v_ai_store int := 0; v_ai_boost int := 0;
  v_mood_overlap int := 0;
  v_reason_codes text[] := '{}';
  v_w record;  -- X6.70 segment-resolved weights
begin
  select * into cfg from public.ai_scoring_config where id=1;
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags, ai_store_key
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;
  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;

  v_key := coalesce(nullif(btrim(pl.ai_store_key),''),
                    public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart));

  v_normalized_slug := public.normalize_store_label(pl.business_category);
  select * into v_w from public._ai_resolve_weights(v_normalized_slug, pl.daypart);

  if ai.track_id is not null and v_key is not null and ai.ai_store_fit ? v_key then
    v_audio := (ai.ai_store_fit->>v_key)::numeric; else v_audio := 50; end if;
  v_meta := 50 + public._ai_overlap(pl.genre_tags, t.genre_tags)*8
              + public._ai_overlap(pl.mood_tags, t.mood_tags)*8
    + (case when ai.track_id is not null then public._ai_overlap(pl.situation_tags, ai.ai_situations)*6 else 0 end)
    - (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*30 else 0 end);
  v_meta := least(100, greatest(0, v_meta));
  v_behav := public._ai_behavior_score(p_playlist_id, p_track_id);
  v_pen := (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*40 else 0 end)
    + (case when t.audio_health_status='conversion_failed' then 50 else 0 end)
    + least(30, coalesce((select count(*) from public.playlist_track_skip_events e
         where e.playlist_id=p_playlist_id and e.track_id=p_track_id
           and e.created_at>now()-interval '30 days' and e.played_seconds>=5),0)*5);
  v_pen := least(100, greatest(0, v_pen));
  v_manual := least(100, greatest(0, v_audio*v_w.fit_audio_w + v_meta*v_w.fit_meta_w
                                    + v_behav*v_w.fit_behavior_w - v_pen*v_w.fit_penalty_w));

  select * into pred from public.track_ai_predictions
    where track_id=p_track_id and model_version='taxonomy-v1';

  if pred.predicted_main_genre is not null
     and exists(select 1 from unnest(pl.genre_tags) g where lower(g)=lower(pred.predicted_main_genre)) then
    v_ai_genre := 5;
    v_reason_codes := array_append(v_reason_codes, 'ai_genre_match');
  end if;

  if pred.predicted_moods is not null then
    select count(*) into v_mood_overlap from unnest(pred.predicted_moods) pm
    join public.taxonomy_moods tm on tm.slug=pm
    where tm.name_ko = any(coalesce(pl.mood_tags,'{}'::text[]));
    v_ai_mood := least(v_mood_overlap*3, 9);
    if v_mood_overlap > 0 then
      v_reason_codes := array_append(v_reason_codes, 'ai_mood_overlap_' || v_mood_overlap::text);
    end if;
  end if;

  if pred.predicted_store_types is not null and v_normalized_slug is not null then
    if array_length(pred.predicted_store_types, 1) >= 1
       and pred.predicted_store_types[1] = v_normalized_slug then
      v_ai_store := v_ai_store + 20;
      v_reason_codes := array_append(v_reason_codes, 'ai_store_top1_match');
    elsif array_length(pred.predicted_store_types, 1) >= 2
          and pred.predicted_store_types[2] = v_normalized_slug then
      v_ai_store := v_ai_store + 10;
      v_reason_codes := array_append(v_reason_codes, 'ai_store_top2_match');
    elsif array_length(pred.predicted_store_types, 1) >= 3
          and pred.predicted_store_types[3] = v_normalized_slug then
      v_ai_store := v_ai_store + 10;
      v_reason_codes := array_append(v_reason_codes, 'ai_store_top3_match');
    end if;

    if pred.prediction_scores ? 'store_type'
       and (pred.prediction_scores->'store_type' ? v_normalized_slug) then
      v_ai_store := v_ai_store + least(10, round(
        (pred.prediction_scores->'store_type'->>v_normalized_slug)::numeric * 30
      )::int);
      v_reason_codes := array_append(v_reason_codes, 'ai_store_prob_boost');
    end if;
  end if;

  v_ai_boost := v_ai_genre + v_ai_mood + v_ai_store;
  v_fit := least(100, greatest(0, v_manual + v_ai_boost));

  if v_key is not null then
    gr := public._ai_check_store_guardrails(p_track_id, v_key);
    if (gr->>'excluded')::boolean then
      v_excluded := true;
      v_gpen := coalesce((gr->>'penalty')::numeric, 0);
      v_fit := greatest(0, v_fit - v_gpen);
      v_reason_codes := array_append(v_reason_codes, 'guardrail_excluded');
    end if;
  end if;

  -- 0241 호환 status 값 (CHECK: active|excluded|review_needed)
  v_status := case when v_excluded then 'excluded'
                   when v_fit < cfg.fit_exclude_cutoff then 'review_needed'
                   else 'active' end;
  v_reason := format('audio %s · meta %s · behavior %s · penalty %s · manual %s · ai_boost +%s · [w:%s]',
    round(v_audio), round(v_meta), round(v_behav), round(v_pen),
    round(v_manual), v_ai_boost, v_w.source);

  insert into public.playlist_track_fit_scores(
    playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
    manual_score, ai_genre_score, ai_mood_score, ai_store_score, ai_boost_total,
    normalized_store_slug, reason_codes, reason, source, status, updated_at, final_fit_score
  ) values (
    p_playlist_id, p_track_id, round(v_fit),
    round(v_audio), round(v_meta), round(v_behav), round(v_pen),
    round(v_manual), v_ai_genre, v_ai_mood, v_ai_store, v_ai_boost,
    v_normalized_slug, v_reason_codes, v_reason, 'algorithm', v_status, now(), round(v_fit)
  )
  on conflict (playlist_id, track_id) do update set
    fit_score = excluded.fit_score, audio_score = excluded.audio_score,
    metadata_score = excluded.metadata_score, behavior_score = excluded.behavior_score,
    penalty_score = excluded.penalty_score, manual_score = excluded.manual_score,
    ai_genre_score = excluded.ai_genre_score, ai_mood_score = excluded.ai_mood_score,
    ai_store_score = excluded.ai_store_score, ai_boost_total = excluded.ai_boost_total,
    normalized_store_slug = excluded.normalized_store_slug, reason_codes = excluded.reason_codes,
    reason = excluded.reason, source = excluded.source,
    -- admin source 는 status 보존 (0241 정책)
    status = case when public.playlist_track_fit_scores.source='admin'
                  then public.playlist_track_fit_scores.status else excluded.status end,
    updated_at = now(), final_fit_score = excluded.final_fit_score;
end; $$;
