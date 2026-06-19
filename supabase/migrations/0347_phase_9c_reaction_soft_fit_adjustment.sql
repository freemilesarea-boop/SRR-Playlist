-- 0347 — Phase 9c: Store Reaction → Fit Score Soft Learning (X6.86)
--
-- 목적:
--   X6.84 에서 수집된 store_track_reactions (👍/👎) 를
--   fit_score 계산에 약하게 보정값으로 반영. 추천 품질을 크게 흔드는 것이 아니라
--   "매장주 행동 데이터가 추천 점수에 안전하게 연결되는 첫 루프" 를 만든다.
--
-- 핵심 원칙:
--   1) guardrail excluded 우선순위 유지 (좋아요여도 excluded 안 풀림)
--   2) 데이터 적을 때 (total_reactions < 3) 전체 집계 보정 = 0
--   3) 직접 매장 반응 (playlists.created_by_user_id = reaction.store_id): like +5 / dislike -8
--   4) 전체 집계 반응: clamp(-5, +3, (like_ratio - 0.5)*6 - dislike_ratio*4)
--   5) fit_score 는 반드시 0..100 clamp
--   6) 기존 behavior_score / regression weight / ai_boost 무수정
--   7) p_store_type 인자는 미리 열어두되 이번 PR 에서 산식 미사용 (X6.88+ 확장)

-- =============================================================================
-- 1. _ai_reaction_adjustment — 매장 반응 보정값 계산
-- =============================================================================
create or replace function public._ai_reaction_adjustment(
  p_track_id uuid,
  p_store_id uuid default null,
  p_store_type text default null
) returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_direct text;
  v_lc int := 0;
  v_dc int := 0;
  v_total int := 0;
  v_lr numeric := 0;  -- 0..1
  v_dr numeric := 0;  -- 0..1
  v_adj numeric := 0;
begin
  if p_track_id is null then
    return 0;
  end if;

  -- 1순위: 직접 매장 반응 (store_id 매칭)
  if p_store_id is not null then
    select reaction_type
      into v_direct
      from public.store_track_reactions
     where store_id = p_store_id and track_id = p_track_id
     limit 1;

    if v_direct = 'like' then
      return 5;
    elsif v_direct = 'dislike' then
      return -8;
    end if;
  end if;

  -- 2순위: 전체 집계 (track_reaction_aggregate.like_ratio/dislike_ratio 는 percent 0..100)
  select coalesce(like_count, 0),
         coalesce(dislike_count, 0),
         coalesce(total_reactions, 0),
         coalesce(like_ratio, 0) / 100.0,
         coalesce(dislike_ratio, 0) / 100.0
    into v_lc, v_dc, v_total, v_lr, v_dr
    from public.track_reaction_aggregate
   where track_id = p_track_id;

  -- 안전장치: 데이터 적으면 전체 집계 보정 0
  if v_total is null or v_total < 3 then
    return 0;
  end if;

  -- 공식: (like_ratio - 0.5) * 6 - dislike_ratio * 4
  --   ex) lr=0.9 dr=0.1 → +2.0
  --       lr=0.5 dr=0.5 → -2.0
  --       lr=0.2 dr=0.8 → -5.0
  v_adj := (v_lr - 0.5) * 6.0 - v_dr * 4.0;

  -- clamp -5 .. +3
  v_adj := greatest(-5.0, least(3.0, v_adj));

  -- p_store_type: X6.86 에서는 미사용 (인자만 열어둠, X6.88+ 확장 예정)
  -- v_store_type_adj := ... (TODO)

  return round(v_adj::numeric, 2);
end;
$$;

revoke execute on function public._ai_reaction_adjustment(uuid, uuid, text) from public, anon;
grant execute on function public._ai_reaction_adjustment(uuid, uuid, text) to authenticated, service_role;

comment on function public._ai_reaction_adjustment(uuid, uuid, text) is
  'X6.86 — fit_score 보조 보정. 직접 매장 like+5/dislike-8, 전체 집계 clamp(-5,+3). guardrail 안 뒤집음.';


-- =============================================================================
-- 2. playlist_track_fit_scores.reaction_adjustment 컬럼 추가
--    not null default 0 → 기존 insert 경로는 그대로 동작 (default 사용)
-- =============================================================================
alter table public.playlist_track_fit_scores
  add column if not exists reaction_adjustment numeric not null default 0;


-- =============================================================================
-- 3. _ai_compute_fit — reaction_adjustment 통합 (0342 base 유지, minimal patch)
--    변경점 (9 items, 실제 운영 DB 적용 기준):
--      #2 declare:  v_reaction_adj numeric := 0
--      #3 ai_boost 직후:  v_reaction_adj := _ai_reaction_adjustment(p_track_id, null, null)
--                        (1순위 직접 매장 tier 는 X6.88+ 에서 store_id 연결 후 적용)
--      #4 v_fit:  + v_reaction_adj 추가, clamp 0..100 유지
--      #5 v_reason:  reaction 값 추가
--      #6 insert columns:  reaction_adjustment
--      #7 values:  v_reaction_adj
--      #8 on conflict:  reaction_adjustment = excluded.reaction_adjustment
--      #9 guardrail penalty:  reaction 적용 후 그대로 (우선순위 유지)
-- =============================================================================
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
  v_w record;
  v_reaction_adj numeric := 0;  -- X6.86 NEW (#2)
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

  -- X6.86 NEW (#3): reaction soft adjustment (2순위 aggregate 만, 1순위 store tier 비활성)
  v_reaction_adj := coalesce(public._ai_reaction_adjustment(p_track_id, null, null), 0);

  -- X6.86 NEW (#4): + v_reaction_adj, clamp 0..100 유지
  v_fit := least(100, greatest(0, v_manual + v_ai_boost + v_reaction_adj));

  -- X6.86 NEW (#9): guardrail penalty 는 reaction 적용 후 그대로 (우선순위 유지)
  if v_key is not null then
    gr := public._ai_check_store_guardrails(p_track_id, v_key);
    if (gr->>'excluded')::boolean then
      v_excluded := true;
      v_gpen := coalesce((gr->>'penalty')::numeric, 0);
      v_fit := greatest(0, v_fit - v_gpen);
      v_reason_codes := array_append(v_reason_codes, 'guardrail_excluded');
    end if;
  end if;

  v_status := case when v_excluded then 'excluded'
                   when v_fit < cfg.fit_exclude_cutoff then 'review_needed'
                   else 'active' end;

  -- X6.86 NEW (#5): reason 문자열에 reaction 값 추가
  v_reason := format('audio %s · meta %s · behavior %s · penalty %s · manual %s · ai_boost +%s · reaction %s · [w:%s]',
    round(v_audio), round(v_meta), round(v_behav), round(v_pen),
    round(v_manual), v_ai_boost,
    case when v_reaction_adj >= 0 then '+' || v_reaction_adj::text else v_reaction_adj::text end,
    v_w.source);

  insert into public.playlist_track_fit_scores(
    playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
    manual_score, ai_genre_score, ai_mood_score, ai_store_score, ai_boost_total,
    normalized_store_slug, reason_codes, reason, source, status, updated_at, final_fit_score,
    reaction_adjustment  -- X6.86 NEW (#6)
  ) values (
    p_playlist_id, p_track_id, round(v_fit),
    round(v_audio), round(v_meta), round(v_behav), round(v_pen),
    round(v_manual), v_ai_genre, v_ai_mood, v_ai_store, v_ai_boost,
    v_normalized_slug, v_reason_codes, v_reason, 'algorithm', v_status, now(), round(v_fit),
    v_reaction_adj  -- X6.86 NEW (#7)
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
    updated_at = now(), final_fit_score = excluded.final_fit_score,
    reaction_adjustment = excluded.reaction_adjustment;  -- X6.86 NEW (#8)
end;
$$;


-- =============================================================================
-- 4. reaction_fit_debug_view — 운영자 SQL 디버깅용
-- =============================================================================
create or replace view public.reaction_fit_debug_view as
  select fs.playlist_id,
         fs.track_id,
         fs.fit_score,
         fs.final_fit_score,
         fs.reaction_adjustment,
         fs.status,
         fs.reason_codes,
         agg.like_count,
         agg.dislike_count,
         agg.total_reactions,
         agg.like_ratio,
         agg.dislike_ratio,
         fs.updated_at
    from public.playlist_track_fit_scores fs
    left join public.track_reaction_aggregate agg on agg.track_id = fs.track_id;

comment on view public.reaction_fit_debug_view is
  'X6.86 — fit_score × reaction 디버깅 view. admin 전용 (기존 fit_scores RLS 따름).';
