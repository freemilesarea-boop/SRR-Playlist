-- 0241 — Phase X2.2 Fit Score v2 (AI boost)
--
-- 목표: _ai_compute_fit 에 X1 taxonomy-v1 결과를 반영하여 store 적합도 정밀화.
--
-- 정책 (사용자 spec):
--   - manual 메타 점수 (기존 audio/meta/behavior/penalty) 유지
--   - AI 신호는 boost 만 — 자동 차단/승인 X
--   - fit_score 계산만 정밀화
--
-- AI boost 공식:
--   genre_ai:  predicted_main_genre ∈ playlist.genre_tags → +5
--   mood_ai:   predicted_moods × playlist.mood_tags overlap → +3 × count, max +9
--   store_ai:  predicted_store_types[1] = normalized slug → +20
--              predicted_store_types[2,3] match → +10 each
--              prediction_scores.store_type[normalized_slug] × 30 (확률 기반 가산)
--              합산 max +50 (top1 20 + top2 10 + top3 10 + prob 10 cap)
--   AI boost 총 max ~64 — final fit_score 는 여전히 0~100 clip.

-- ===== A. playlist_track_fit_scores 컬럼 확장 =====
alter table public.playlist_track_fit_scores
  add column if not exists manual_score numeric,         -- baseline (X1 boost 없이)
  add column if not exists ai_store_score int,
  add column if not exists ai_mood_score int,
  add column if not exists ai_genre_score int,
  add column if not exists ai_boost_total int,
  add column if not exists normalized_store_slug text,
  add column if not exists reason_codes text[];

-- ===== B. _ai_compute_fit v2 =====
create or replace function public._ai_compute_fit(p_playlist_id uuid, p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pl record; ai record; t record; cfg record; gr jsonb; pred record;
  v_key text; v_audio numeric; v_meta numeric; v_behav numeric; v_pen numeric;
  v_manual numeric; v_fit numeric;
  v_status text; v_reason text; v_excluded boolean := false; v_gpen numeric := 0;
  -- X2.2 AI boost
  v_normalized_slug text;
  v_ai_genre int := 0; v_ai_mood int := 0; v_ai_store int := 0; v_ai_boost int := 0;
  v_mood_overlap int := 0;
  v_reason_codes text[] := '{}';
begin
  select * into cfg from public.ai_scoring_config where id=1;
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags, ai_store_key
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;
  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;

  v_key := coalesce(nullif(btrim(pl.ai_store_key),''),
                    public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart));

  -- 기존 점수 (manual baseline)
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
  v_manual := least(100, greatest(0, v_audio*cfg.fit_audio_w + v_meta*cfg.fit_meta_w
                                    + v_behav*cfg.fit_behavior_w - v_pen*cfg.fit_penalty_w));

  -- ===== X2.2 AI boost =====
  select * into pred from public.track_ai_predictions
    where track_id=p_track_id and model_version='taxonomy-v1';
  v_normalized_slug := public.normalize_store_label(pl.business_category);

  if pred.predicted_main_genre is not null
     and exists(select 1 from unnest(pl.genre_tags) g where lower(g)=lower(pred.predicted_main_genre)) then
    v_ai_genre := 5;
    v_reason_codes := v_reason_codes || 'ai_genre_match';
  end if;

  if pred.predicted_moods is not null then
    select count(*) into v_mood_overlap from unnest(pred.predicted_moods) pm
    join public.taxonomy_moods tm on tm.slug=pm
    where tm.name_ko = any(coalesce(pl.mood_tags,'{}'::text[]));
    v_ai_mood := least(v_mood_overlap*3, 9);
    if v_mood_overlap > 0 then
      v_reason_codes := v_reason_codes || ('ai_mood_overlap_' || v_mood_overlap);
    end if;
  end if;

  -- store_ai: top1 +20 / top2+top3 +10 each + prediction_scores 확률 × 30 (max 10)
  if pred.predicted_store_types is not null and v_normalized_slug is not null then
    if array_length(pred.predicted_store_types, 1) >= 1
       and pred.predicted_store_types[1] = v_normalized_slug then
      v_ai_store := v_ai_store + 20;
      v_reason_codes := v_reason_codes || 'ai_store_top1_match';
    elsif array_length(pred.predicted_store_types, 1) >= 2
          and pred.predicted_store_types[2] = v_normalized_slug then
      v_ai_store := v_ai_store + 10;
      v_reason_codes := v_reason_codes || 'ai_store_top2_match';
    elsif array_length(pred.predicted_store_types, 1) >= 3
          and pred.predicted_store_types[3] = v_normalized_slug then
      v_ai_store := v_ai_store + 10;
      v_reason_codes := v_reason_codes || 'ai_store_top3_match';
    end if;

    -- 확률 기반 가산 (prediction_scores.store_type[slug] × 30, cap 10)
    if pred.prediction_scores ? 'store_type'
       and (pred.prediction_scores->'store_type' ? v_normalized_slug) then
      v_ai_store := v_ai_store + least(10, round(
        (pred.prediction_scores->'store_type'->>v_normalized_slug)::numeric * 30
      )::int);
      v_reason_codes := v_reason_codes || 'ai_store_prob_boost';
    end if;
  end if;

  v_ai_boost := v_ai_genre + v_ai_mood + v_ai_store;

  -- Final fit_score = manual baseline + AI boost (0~100 clip)
  v_fit := least(100, greatest(0, v_manual + v_ai_boost));

  -- Hard Guardrails (추천 점수보다 공간 분위기 보호 우선)
  if v_key is not null then
    gr := public._ai_check_store_guardrails(p_track_id, v_key);
    if (gr->>'blocked')::boolean then
      v_fit := 0; v_excluded := true;
      v_reason := '[guardrail hard_block] ' || coalesce((select string_agg(e->>'reason',', ') from jsonb_array_elements(gr->'violations') e), '');
      v_reason_codes := v_reason_codes || 'guardrail_blocked';
    else
      v_gpen := coalesce((gr->>'penalty_score')::numeric, 0);
      if v_gpen > 0 then
        v_fit := greatest(0, v_fit - v_gpen);
        v_reason_codes := v_reason_codes || ('guardrail_penalty_' || round(v_gpen));
      end if;
    end if;
  end if;

  if ai.track_id is not null and v_key is not null and ai.ai_exclusions @> array[v_key] then
    v_excluded := true;
    v_reason_codes := v_reason_codes || 'ai_excluded';
  end if;

  if v_status is null then
    v_status := case when v_excluded then 'excluded'
                     when v_fit < cfg.fit_exclude_cutoff then 'review_needed'
                     else 'active' end;
  end if;
  if v_reason is null then
    v_reason := format('audio %s · meta %s · behavior %s · penalty %s · manual %s · ai_boost +%s (g%s/m%s/s%s)%s%s',
      round(v_audio), round(v_meta), round(v_behav), round(v_pen),
      round(v_manual), v_ai_boost, v_ai_genre, v_ai_mood, v_ai_store,
      case when v_key is not null then ' · store='||v_key else '' end,
      case when v_gpen>0 then ' · guardrail -'||round(v_gpen) else '' end);
  end if;

  insert into public.playlist_track_fit_scores(
    playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
    reason, source, status, updated_at,
    manual_score, ai_store_score, ai_mood_score, ai_genre_score, ai_boost_total,
    normalized_store_slug, reason_codes
  )
  values (p_playlist_id, p_track_id, round(v_fit),
          round(v_audio), round(v_meta), round(v_behav), round(v_pen),
          v_reason, 'algorithm', v_status, now(),
          round(v_manual), v_ai_store, v_ai_mood, v_ai_genre, v_ai_boost,
          v_normalized_slug, v_reason_codes)
  on conflict (playlist_id, track_id) do update set
    fit_score=excluded.fit_score, audio_score=excluded.audio_score, metadata_score=excluded.metadata_score,
    behavior_score=excluded.behavior_score, penalty_score=excluded.penalty_score, reason=excluded.reason,
    status=case when public.playlist_track_fit_scores.source='admin'
                then public.playlist_track_fit_scores.status else excluded.status end,
    updated_at=now(),
    manual_score=excluded.manual_score,
    ai_store_score=excluded.ai_store_score,
    ai_mood_score=excluded.ai_mood_score,
    ai_genre_score=excluded.ai_genre_score,
    ai_boost_total=excluded.ai_boost_total,
    normalized_store_slug=excluded.normalized_store_slug,
    reason_codes=excluded.reason_codes;
end; $$;
