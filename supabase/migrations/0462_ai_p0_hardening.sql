-- 0462_ai_p0_hardening.sql
-- Phase AI-PLAYLIST-P0-HARDENING-1 — Reaction Security, Guardrail Correctness & Safe Automation Gate
--
-- DRAFT — applied to Test DB (haojpuhztegecbrwqorr) ONLY. NOT applied to Production (nsoesrvwkxqifjcxzvol).
--
-- Scope: fix EXISTING security/correctness defects surfaced by AI-PLAYLIST-ENGINE-AUDIT-1.
-- No new AI automation, no new provider, no scoring-formula redesign, no playback/queue/scheduler change.
-- All changes additive/idempotent; no destructive DROP; no data deletion; explicit search_path.
--
-- Findings addressed:
--   A. Store reaction spoofing  — upsert_store_track_reaction trusted client p_store_id (0345).
--   B. Anonymous behavior inject — record_play_event granted to anon, no validation (0158); events fed scoring (0162).
--   C. Guardrail JSON contract  — _ai_compute_fit read excluded/penalty; engine returns blocked/penalty_score (0347 vs 0208).
--   D. Store-type vocabulary     — get_playlist_tracks/normalize_store_label (taxonomy slug) vs store_guardrails.store_key
--                                  mismatch → guardrails fired for only 4 store types; rest fail-open (0404/0173).
--   E. Safe automation gate      — daily refresh force-defaulted auto_attach_enabled=true, injected to live playlists
--                                  with no human approval (0341).
-- Genre guardrail (§5): store_guardrails' own rule_type='genre' path (restored by fix C) enforces genre blocking.
--   We deliberately do NOT also re-wire the separate genre_store_guardrails(0286) into _ai_compute_fit — doing so would
--   double-penalize the same store×genre. genre_store_guardrails remains available for placement-time use.

-- ============================================================================
-- 0. Canonical store-type SSOT  (Finding D)
--    Maps any vocabulary (taxonomy slug / store_guardrails.store_key / Korean / English / legacy)
--    to ONE canonical store-type. Unknown → lower/trim passthrough (matches only an identical key → safe
--    fail-open, never a wrong guess). NULL → NULL. Used at guardrail-match time so runtime (taxonomy slug)
--    and fit (playlist store key) both resolve to the same space as seeded store_guardrails rows.
--    NOTE: guardrail penalty is max-based (greatest()) and blocking is boolean-OR, so a canonical match that
--    hits multiple seeded rows CANNOT double-penalize.
-- ============================================================================
create or replace function public._ai_canonical_store_type(p_raw text)
returns text
language sql
immutable
security definer
set search_path to 'public'
as $$
  select case lower(btrim(coalesce(p_raw, '')))
    -- cafe
    when 'cafe' then 'cafe' when '카페' then 'cafe' when 'coffee_shop' then 'cafe' when 'coffee shop' then 'cafe'
    when 'cafe_independent' then 'cafe' when 'cafe_franchise' then 'cafe' when 'brunch_cafe' then 'cafe'
    -- hospital
    when 'hospital' then 'hospital' when '병원' then 'hospital' when '의원' then 'hospital' when '클리닉' then 'hospital' when 'clinic' then 'hospital'
    -- select shop
    when 'select_shop' then 'select_shop' when '편집샵' then 'select_shop' when 'boutique' then 'select_shop'
    when '부티크' then 'select_shop' when 'clothing_store' then 'select_shop'
    -- hair salon (taxonomy 'beauty_shop' is coarse → treated as hair_salon; nail_shop kept distinct)
    when 'hair_salon' then 'hair_salon' when 'salon' then 'hair_salon' when '미용실' then 'hair_salon'
    when '헤어샵' then 'hair_salon' when 'beauty_shop' then 'hair_salon' when '뷰티샵' then 'hair_salon'
    -- nail shop
    when 'nail_shop' then 'nail_shop' when '네일샵' then 'nail_shop' when 'nail' then 'nail_shop'
    -- restaurants
    when 'korean_restaurant' then 'korean_restaurant' when '한식' then 'korean_restaurant' when '한식당' then 'korean_restaurant'
    when 'japanese_restaurant' then 'japanese_restaurant' when '일식' then 'japanese_restaurant'
    when 'chinese_restaurant' then 'chinese_restaurant' when '중식' then 'chinese_restaurant'
    when 'western_restaurant' then 'western_restaurant' when '양식' then 'western_restaurant'
    when 'fine_dining' then 'fine_dining' when '파인다이닝' then 'fine_dining' when '다이닝' then 'fine_dining'
    when 'izakaya' then 'izakaya' when '이자카야' then 'izakaya'
    when 'restaurant' then 'restaurant' when '식당' then 'restaurant' when '레스토랑' then 'restaurant' when '술집' then 'restaurant'
    -- bars
    when 'pub' then 'pub' when '펍' then 'pub'
    when 'wine_bar' then 'wine_bar' when 'winebar' then 'wine_bar' when '와인바' then 'wine_bar'
    when 'cocktail_bar' then 'wine_bar' when '칵테일바' then 'wine_bar' when '라운지바' then 'wine_bar'
    -- gym
    when 'gym' then 'gym' when 'fitness' then 'gym' when '헬스장' then 'gym' when '피트니스' then 'gym' when '짐' then 'gym'
    -- hotel
    when 'hotel' then 'hotel' when 'hotel_lobby' then 'hotel' when '호텔' then 'hotel' when '라운지' then 'hotel' when 'lounge' then 'hotel'
    -- office
    when 'office' then 'office' when '사무실' then 'office' when 'coworking' then 'office' when '코워킹' then 'office'
    -- studio
    when 'studio' then 'studio' when '스튜디오' then 'studio'
    -- bookstore
    when 'bookstore' then 'bookstore' when '서점' then 'bookstore' when '책방' then 'bookstore'
    -- flower shop
    when 'flower_shop' then 'flower_shop' when '화원' then 'flower_shop' when '플라워샵' then 'flower_shop' when '꽃집' then 'flower_shop'
    -- showroom
    when 'showroom' then 'showroom' when '쇼룸' then 'showroom'
    -- pilates / yoga
    when 'pilates' then 'pilates' when '필라테스' then 'pilates'
    when 'yoga' then 'yoga' when '요가' then 'yoga'
    -- study cafe
    when 'study_cafe' then 'study_cafe' when '스터디카페' then 'study_cafe' when 'studycafe' then 'study_cafe'
    -- pc bang
    when 'pc_bang' then 'pc_bang' when 'pc방' then 'pc_bang' when '피시방' then 'pc_bang'
    when 'pcroom' then 'pc_bang' when 'pc_room' then 'pc_bang' when 'internet_cafe' then 'pc_bang'
    -- unknown → passthrough (only matches an identical seeded key; no wrong guess)
    else nullif(lower(btrim(coalesce(p_raw, ''))), '')
  end;
$$;
revoke all on function public._ai_canonical_store_type(text) from public, anon;
grant execute on function public._ai_canonical_store_type(text) to authenticated, service_role;
comment on function public._ai_canonical_store_type(text) is
  'P0(0462) — canonical store-type SSOT for guardrail matching. Unknown → passthrough (safe). NULL → NULL.';

-- ============================================================================
-- A. Reaction spoofing fix (Finding A) — upsert_store_track_reaction
--    Add store-ownership authorization: only the store user itself, its managing franchise HQ,
--    or a platform admin may write. Client-supplied p_store_id is no longer trusted. Fail-closed.
-- ============================================================================
create or replace function public.upsert_store_track_reaction(
  p_store_id uuid,
  p_track_id uuid,
  p_reaction_type text,
  p_playlist_id uuid default null,
  p_business_id uuid default null
)
returns public.store_track_reactions
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.store_track_reactions;
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;
  if p_store_id is null then
    raise exception 'invalid_store';
  end if;
  if p_reaction_type not in ('like', 'dislike') then
    raise exception 'invalid_reaction_type';
  end if;
  if not exists (select 1 from public.tracks where id = p_track_id) then
    raise exception 'invalid_track';
  end if;

  -- store-ownership gate (fail-closed). Store = business-plan user whose id = store_id.
  if not (
    v_uid = p_store_id
    or exists (
      select 1 from public.franchise_stores fs
        join public.franchise_admins fa
          on fa.franchise_id = fs.franchise_id and fa.user_id = v_uid
       where fs.store_id = p_store_id
    )
    or exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin')
  ) then
    raise exception 'store_access_denied';
  end if;

  insert into public.store_track_reactions
    (store_id, business_id, track_id, playlist_id, reaction_type, source, user_id, updated_at)
  values
    (p_store_id, p_business_id, p_track_id, p_playlist_id,
     p_reaction_type, 'store_player', v_uid, now())
  on conflict (store_id, track_id) do update set
    reaction_type = excluded.reaction_type,
    playlist_id = coalesce(excluded.playlist_id, public.store_track_reactions.playlist_id),
    business_id = coalesce(excluded.business_id, public.store_track_reactions.business_id),
    user_id = excluded.user_id,
    updated_at = now()
  returning * into v_row;

  return v_row;
end; $$;
revoke execute on function public.upsert_store_track_reaction(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.upsert_store_track_reaction(uuid, uuid, text, uuid, uuid) to authenticated;

-- ============================================================================
-- B. Anonymous behavior injection (Finding B) — trusted classification
--    anon (unauthenticated) events are recorded but marked trusted=false and EXCLUDED from AI behavior scoring.
--    Also reject physically-impossible completion. anon GRANT preserved (public preview logging must not break).
-- ============================================================================
alter table public.track_play_events
  add column if not exists trusted boolean not null default true;

-- Backfill: historical anon rows (no user_id) → untrusted, so they cannot influence scoring.
update public.track_play_events
   set trusted = (user_id is not null)
 where trusted is distinct from (user_id is not null);

create or replace function public.record_play_event(
  p_track_id uuid, p_playlist_id uuid, p_event_type text,
  p_played numeric default null, p_duration numeric default null,
  p_skip_reason text default null, p_device text default null, p_anon_id text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_ratio numeric; v_trusted boolean;
begin
  if p_event_type not in ('play','start','skip','complete','like','unlike','error') then
    raise exception 'invalid event_type %', p_event_type;
  end if;
  -- reject physically-impossible completion (client-reported played grossly exceeds duration)
  if p_duration is not null and p_duration > 0
     and p_played is not null and p_played > p_duration * 1.5 then
    raise exception 'invalid_event: played exceeds duration';
  end if;
  -- untrusted unless authenticated
  v_trusted := (v_uid is not null);
  v_ratio := case when p_duration is not null and p_duration>0
                  then least(1, greatest(0, coalesce(p_played,0)/p_duration)) else null end;
  insert into public.track_play_events(track_id, playlist_id, user_id, session_id, event_type,
                                       played_seconds, duration_seconds, completion_ratio, skip_reason, device, trusted)
  values (p_track_id, p_playlist_id, v_uid, nullif(btrim(coalesce(p_anon_id,'')),''), p_event_type,
          greatest(coalesce(p_played,0),0), p_duration, v_ratio, p_skip_reason, p_device, v_trusted);
  return jsonb_build_object('ok', true, 'trusted', v_trusted);
end; $$;
-- grant unchanged (anon preview logging preserved; anon events are untrusted → excluded from scoring)
grant execute on function public.record_play_event(uuid, uuid, text, numeric, numeric, text, text, text) to anon, authenticated;

-- Behavior score now counts TRUSTED events only (untrusted/anon excluded).
create or replace function public._ai_behavior_score(p_playlist_id uuid, p_track_id uuid)
returns numeric language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_plays int; v_skips int; v_comps int; v_likes int; v_errs int; v_depth numeric; v_n int;
  comp_r numeric; skip_r numeric; like_r numeric; err_r numeric; raw numeric;
begin
  select count(*) filter (where event_type in ('play','start')),
         count(*) filter (where event_type='skip'),
         count(*) filter (where event_type='complete'),
         count(*) filter (where event_type='like'),
         count(*) filter (where event_type='error'),
         coalesce(avg(completion_ratio) filter (where completion_ratio is not null), 0),
         count(*)
    into v_plays, v_skips, v_comps, v_likes, v_errs, v_depth, v_n
  from public.track_play_events
  where track_id=p_track_id and (p_playlist_id is null or playlist_id=p_playlist_id)
    and trusted = true                                   -- P0(0462): untrusted/anon excluded
    and created_at > now()-interval '90 days';
  if coalesce(v_plays,0) = 0 then return 50; end if;
  comp_r := least(1, v_comps::numeric/v_plays);
  skip_r := least(1, v_skips::numeric/v_plays);
  like_r := least(1, v_likes::numeric/v_plays);
  err_r  := least(1, v_errs::numeric/v_plays);
  raw := comp_r*60 + like_r*20 + v_depth*20 - skip_r*40 - err_r*30;
  raw := least(100, greatest(0, raw));
  if v_n < 5 then raw := 50 + (raw-50)*(v_n::numeric/5); end if;
  return round(raw);
end; $$;

-- ============================================================================
-- D. Store guardrail engine — canonical matching (Finding D)
--    Reproduces 0208 body; ONLY the override lookup + rule-loop WHERE now match by canonical store type.
--    Penalty aggregation is max-based → canonical multi-row match cannot double-penalize.
-- ============================================================================
create or replace function public._ai_check_store_guardrails(p_track_id uuid, p_store_key text)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  f record; t record; m record; g record;
  v_tgen text[]; v_mood text; fv numeric; viol boolean; hit boolean;
  v_violations jsonb := '[]'::jsonb; v_pen numeric := 0; v_max_sev text := null; v_blocked boolean := false;
  v_canon text := public._ai_canonical_store_type(p_store_key);
begin
  if exists (
    select 1 from public.store_guardrail_overrides o
     where o.track_id = p_track_id
       and public._ai_canonical_store_type(o.store_key) = v_canon
  ) then
    return jsonb_build_object('passed', true, 'blocked', false, 'severity', null, 'violations', '[]'::jsonb, 'penalty_score', 0, 'overridden', true);
  end if;
  select * into f from public.track_audio_features where track_id=p_track_id;
  select tr.main_genre, tr.genre_tags, tr.mood, coalesce(tr.explicit_content,false) as explicit into t from public.tracks tr where tr.id=p_track_id;
  select ai_moods into m from public.track_ai_metadata where track_id=p_track_id;
  select array_agg(distinct x) into v_tgen from (
    select public._ai_norm_genre(z) x from unnest(array_remove(array[t.main_genre] || coalesce(t.genre_tags,'{}'), null)) z
    where public._ai_norm_genre(z) <> '') s;
  v_tgen := coalesce(v_tgen,'{}');
  v_mood := lower(coalesce(t.mood,'') || ' ' || array_to_string(coalesce(m.ai_moods,'{}'), ' '));

  for g in select * from public.store_guardrails
            where enabled and public._ai_canonical_store_type(store_key) = v_canon loop
    viol := false; hit := false;
    if g.rule_type = 'numeric' then
      fv := case
        when g.rule_key in ('max_energy','min_energy') then f.energy
        when g.rule_key in ('max_bpm','min_bpm') then f.bpm
        when g.rule_key = 'max_acousticness' then f.acousticness
        when g.rule_key = 'max_brightness' then f.brightness
        when g.rule_key = 'max_vocal_presence' then f.vocal_presence
        when g.rule_key = 'max_loudness' then f.loudness
        when g.rule_key in ('max_instrumentalness','min_instrumentalness') then f.instrumentalness
        when g.rule_key = 'max_danceability' then f.danceability
        else null end;
      if fv is not null then
        viol := case g.operator
          when '>' then fv > g.value::numeric when '<' then fv < g.value::numeric
          when '>=' then fv >= g.value::numeric when '<=' then fv <= g.value::numeric else false end;
        hit := true;
      end if;
    elsif g.rule_type = 'genre' and g.operator='contains' then
      viol := public._ai_norm_genre(g.value) = any(v_tgen); hit := true;
    elsif g.rule_type = 'mood' and g.operator='contains' then
      viol := v_mood like '%'||lower(g.value)||'%'; hit := true;
    elsif g.rule_type = 'flag' and g.operator='is_true' then
      viol := t.explicit; hit := true;
    end if;

    if hit and viol then
      v_violations := v_violations || jsonb_build_object('rule_key', g.rule_key, 'severity', g.severity, 'reason', g.reason);
      if g.severity='hard_block' then v_blocked := true; v_pen := 100; v_max_sev := 'hard_block';
      elsif g.severity='soft_block' then v_pen := greatest(v_pen, 50); if v_max_sev is null or v_max_sev='warning' then v_max_sev := 'soft_block'; end if;
      else v_pen := greatest(v_pen, 15); if v_max_sev is null then v_max_sev := 'warning'; end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('passed', not v_blocked, 'blocked', v_blocked, 'severity', v_max_sev,
    'violations', v_violations, 'penalty_score', v_pen, 'overridden', false);
end; $function$;

-- ============================================================================
-- C. Guardrail contract fix (Finding C) — _ai_compute_fit
--    Reproduces 0347 body; ONLY the guardrail block changed to read the ACTUAL contract keys
--    (blocked / penalty_score) and to apply a soft (non-blocking) penalty once. All else identical.
-- ============================================================================
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
  v_reaction_adj numeric := 0;
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

  v_reaction_adj := coalesce(public._ai_reaction_adjustment(p_track_id, null, null), 0);

  v_fit := least(100, greatest(0, v_manual + v_ai_boost + v_reaction_adj));

  -- P0(0462) Finding C: read the ACTUAL guardrail contract (blocked / penalty_score).
  -- hard-block → exclude + subtract penalty; soft/warning → subtract penalty ONCE (no double-count).
  if v_key is not null then
    gr := public._ai_check_store_guardrails(p_track_id, v_key);
    v_gpen := coalesce((gr->>'penalty_score')::numeric, 0);
    if coalesce((gr->>'blocked')::boolean, false) then
      v_excluded := true;
      v_fit := greatest(0, v_fit - v_gpen);
      v_reason_codes := array_append(v_reason_codes, 'guardrail_excluded');
    elsif v_gpen > 0 then
      v_fit := greatest(0, v_fit - v_gpen);
      v_reason_codes := array_append(v_reason_codes, 'guardrail_penalty');
    end if;
  end if;

  v_status := case when v_excluded then 'excluded'
                   when v_fit < cfg.fit_exclude_cutoff then 'review_needed'
                   else 'active' end;

  v_reason := format('audio %s · meta %s · behavior %s · penalty %s · manual %s · ai_boost +%s · reaction %s · [w:%s]',
    round(v_audio), round(v_meta), round(v_behav), round(v_pen),
    round(v_manual), v_ai_boost,
    case when v_reaction_adj >= 0 then '+' || v_reaction_adj::text else v_reaction_adj::text end,
    v_w.source);

  insert into public.playlist_track_fit_scores(
    playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
    manual_score, ai_genre_score, ai_mood_score, ai_store_score, ai_boost_total,
    normalized_store_slug, reason_codes, reason, source, status, updated_at, final_fit_score,
    reaction_adjustment
  ) values (
    p_playlist_id, p_track_id, round(v_fit),
    round(v_audio), round(v_meta), round(v_behav), round(v_pen),
    round(v_manual), v_ai_genre, v_ai_mood, v_ai_store, v_ai_boost,
    v_normalized_slug, v_reason_codes, v_reason, 'algorithm', v_status, now(), round(v_fit),
    v_reaction_adj
  )
  on conflict (playlist_id, track_id) do update set
    fit_score = excluded.fit_score, audio_score = excluded.audio_score,
    metadata_score = excluded.metadata_score, behavior_score = excluded.behavior_score,
    penalty_score = excluded.penalty_score, manual_score = excluded.manual_score,
    ai_genre_score = excluded.ai_genre_score, ai_mood_score = excluded.ai_mood_score,
    ai_store_score = excluded.ai_store_score, ai_boost_total = excluded.ai_boost_total,
    normalized_store_slug = excluded.normalized_store_slug, reason_codes = excluded.reason_codes,
    reason = excluded.reason, source = excluded.source,
    status = case when public.playlist_track_fit_scores.source='admin'
                  then public.playlist_track_fit_scores.status else excluded.status end,
    updated_at = now(), final_fit_score = excluded.final_fit_score,
    reaction_adjustment = excluded.reaction_adjustment;
end;
$$;

-- ============================================================================
-- E. Safe automation gate (Finding E)
--    Live auto-attach requires EXPLICIT human approval (new auto_attach_approved, default false).
--    Auto-attach is opt-in (default false) AND approval-gated. daily refresh no longer self-enables.
-- ============================================================================
alter table public.playlists
  add column if not exists auto_attach_approved boolean not null default false;
-- Opt-in going forward (was defaulted true by 0341). Existing rows preserved; approval gate makes them inert.
alter table public.playlists alter column auto_attach_enabled set default false;

-- Admin-only approval toggle (PROPOSED → APPROVED). Reuses existing admin gate pattern.
create or replace function public.admin_set_playlist_auto_attach_approval(p_playlist_id uuid, p_approved boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  update public.playlists set auto_attach_approved = coalesce(p_approved, false), updated_at = now()
   where id = p_playlist_id;
  if not found then raise exception 'playlist not found'; end if;
  return jsonb_build_object('ok', true, 'playlist_id', p_playlist_id, 'auto_attach_approved', coalesce(p_approved,false));
end; $$;
revoke execute on function public.admin_set_playlist_auto_attach_approval(uuid, boolean) from public, anon;
grant execute on function public.admin_set_playlist_auto_attach_approval(uuid, boolean) to authenticated;

-- _auto_refresh_one_playlist: require enabled AND approved (fail-closed). Body identical to 0341 otherwise.
create or replace function public._auto_refresh_one_playlist(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_pl record;
  v_min_fit numeric;
  v_max_inject int;
  v_lookback int;
  v_added int := 0;
  v_evaluated int := 0;
  v_next_order int;
  v_cand record;
  v_fit_score numeric;
  v_added_track_ids uuid[] := '{}';
begin
  select id, business_category, title, archived_at,
         coalesce(is_recommendable, true) as is_recommendable,
         coalesce(auto_attach_enabled, false) as auto_enabled,
         coalesce(auto_attach_approved, false) as auto_approved,
         coalesce(auto_attach_threshold, 70) as threshold,
         coalesce(auto_refresh_max_inject, 3) as max_inject,
         coalesce(auto_refresh_lookback_days, 14) as lookback_days
    into v_pl from public.playlists where id = p_playlist_id;
  if v_pl.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_pl.archived_at is not null then
    return jsonb_build_object('ok', true, 'reason', 'archived', 'added', 0);
  end if;
  if not v_pl.auto_enabled then
    return jsonb_build_object('ok', true, 'reason', 'auto_disabled', 'added', 0);
  end if;
  -- P0(0462): live attach requires explicit human approval.
  if not v_pl.auto_approved then
    return jsonb_build_object('ok', true, 'reason', 'not_approved', 'added', 0);
  end if;
  if not v_pl.is_recommendable then
    return jsonb_build_object('ok', true, 'reason', 'not_recommendable', 'added', 0);
  end if;

  v_min_fit := v_pl.threshold;
  v_max_inject := v_pl.max_inject;
  v_lookback := v_pl.lookback_days;

  select coalesce(max(order_index), 0) + 1 into v_next_order
    from public.playlist_tracks where playlist_id = p_playlist_id;

  for v_cand in
    select t.id as track_id, t.title
    from public.tracks t
    where t.release_status='released'
      and t.audio_url is not null and t.audio_url <> ''
      and t.released_at >= now() - (v_lookback || ' days')::interval
      and not exists (
        select 1 from public.playlist_tracks pt
        where pt.playlist_id = p_playlist_id
          and pt.track_id = t.id
      )
      and not exists (
        select 1 from public.track_store_exclusions ex
        where ex.track_id = t.id
          and ex.is_active = true
          and ex.store_type_slug = public.normalize_store_label(v_pl.business_category)
      )
    order by t.released_at desc
    limit 200
  loop
    v_evaluated := v_evaluated + 1;

    select final_fit_score into v_fit_score
      from public.playlist_track_fit_scores
     where playlist_id = p_playlist_id and track_id = v_cand.track_id;

    if v_fit_score is null then
      perform public._ai_compute_fit(p_playlist_id, v_cand.track_id);
      select final_fit_score into v_fit_score
        from public.playlist_track_fit_scores
       where playlist_id = p_playlist_id and track_id = v_cand.track_id;
    end if;

    if v_fit_score is null or v_fit_score < v_min_fit then continue; end if;

    insert into public.playlist_tracks
      (playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
    values
      (p_playlist_id, v_cand.track_id, v_next_order, v_fit_score, 'auto_daily', 'system')
    on conflict (playlist_id, track_id) do nothing;

    v_added := v_added + 1;
    v_next_order := v_next_order + 1;
    v_added_track_ids := v_added_track_ids || v_cand.track_id;

    exit when v_added >= v_max_inject;
  end loop;

  update public.playlists
     set last_auto_refresh_at = now(),
         last_auto_refresh_added = v_added
   where id = p_playlist_id;

  return jsonb_build_object(
    'ok', true, 'playlist_id', p_playlist_id, 'title', v_pl.title,
    'evaluated', v_evaluated, 'added', v_added, 'min_fit', v_min_fit,
    'max_inject', v_max_inject, 'added_tracks', to_jsonb(v_added_track_ids)
  );
end; $$;
revoke execute on function public._auto_refresh_one_playlist(uuid) from public, anon;

-- cron_daily_playlist_refresh: only enabled AND approved playlists are eligible.
create or replace function public.cron_daily_playlist_refresh()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_run_id uuid;
  v_pl record;
  v_one jsonb;
  v_details jsonb := '[]'::jsonb;
  v_total_added int := 0;
  v_total_skipped int := 0;
  v_total_pls int := 0;
begin
  insert into public.playlist_auto_refresh_runs (triggered_by)
  values ('cron') returning id into v_run_id;

  for v_pl in
    select id from public.playlists
    where status='released'
      and archived_at is null
      and coalesce(auto_attach_enabled, false) = true
      and coalesce(auto_attach_approved, false) = true   -- P0(0462): approval-gated
      and coalesce(is_recommendable, true) = true
    order by coalesce(recommendation_priority, 0) desc, id
  loop
    v_total_pls := v_total_pls + 1;
    begin
      v_one := public._auto_refresh_one_playlist(v_pl.id);
      v_details := v_details || jsonb_build_array(v_one);
      if (v_one->>'added')::int > 0 then
        v_total_added := v_total_added + (v_one->>'added')::int;
      else
        v_total_skipped := v_total_skipped + 1;
      end if;
    exception when others then
      v_details := v_details || jsonb_build_array(
        jsonb_build_object('playlist_id', v_pl.id, 'error', SQLERRM)
      );
    end;
  end loop;

  update public.playlist_auto_refresh_runs
     set finished_at = now(), total_playlists = v_total_pls,
         total_added = v_total_added, total_skipped = v_total_skipped, details = v_details
   where id = v_run_id;

  return jsonb_build_object('ok', true, 'run_id', v_run_id, 'playlists', v_total_pls,
    'added', v_total_added, 'skipped', v_total_skipped);
exception when others then
  update public.playlist_auto_refresh_runs
     set finished_at = now(), error = SQLERRM, details = v_details
   where id = v_run_id;
  return jsonb_build_object('ok', false, 'run_id', v_run_id, 'error', SQLERRM);
end; $$;
revoke execute on function public.cron_daily_playlist_refresh() from public, anon;
