-- 0260 — Phase X5.2 Store Profile Engine
--
-- 목표: 곡 audio features (energy, speechiness, instrumentalness, acousticness)
--       기반 매장 적합도 평가. 장르(X5)만으로 부족한 분위기 가드레일.
--
-- 정책:
--   - 각 조건 통과 → +5 bonus per 조건
--   - 각 조건 위반 → -10 penalty per 조건
--   - 위반 ≥3 또는 심각도 high → severity='high', 추가 fit -20
--   - 데이터 NULL → 해당 조건 평가 skip (penalty/bonus 모두 0)
--
-- 데이터 출처:
--   1순위: track_audio_features (numeric 0-1)
--   fallback: track_analysis.instrumentalness/100, tracks.instrumental boolean
--   speechiness: af.speechiness, fallback (instrumental=true → 0.05) else NULL

-- ===== A. store_audio_profiles =====
create table if not exists public.store_audio_profiles (
  id                    uuid primary key default gen_random_uuid(),
  store_slug            text not null unique,
  energy_min            numeric,
  energy_max            numeric,
  speechiness_max       numeric,
  instrumentalness_min  numeric,
  acousticness_min      numeric,
  bonus_per_match       numeric not null default 5,
  penalty_per_violation numeric not null default 10,
  severity_threshold    int not null default 3,  -- 위반 ≥N → severity=high
  description           text,
  is_active             boolean not null default true,
  updated_at            timestamptz not null default now()
);

alter table public.store_audio_profiles enable row level security;
drop policy if exists "sap admin all" on public.store_audio_profiles;
create policy "sap admin all" on public.store_audio_profiles for all to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. Seed (사용자 spec) =====
insert into public.store_audio_profiles
  (store_slug, energy_min, energy_max, speechiness_max, instrumentalness_min, acousticness_min, description)
values
  ('winebar',  null, 0.45, 0.15, 0.30, 0.20, '와인바: 차분·악기 중심·낮은 보컬·아쿠스틱'),
  ('hotel',    null, 0.55, 0.20, null, null, '호텔: 중간 에너지·낮은 보컬'),
  ('hospital', null, 0.35, 0.10, null, null, '병원: 매우 차분·매우 낮은 보컬'),
  ('fitness',  0.70, null, null, null, null, '피트니스: 고에너지')
on conflict (store_slug) do update set
  energy_min           = excluded.energy_min,
  energy_max           = excluded.energy_max,
  speechiness_max      = excluded.speechiness_max,
  instrumentalness_min = excluded.instrumentalness_min,
  acousticness_min     = excluded.acousticness_min,
  description          = excluded.description,
  updated_at           = now();

-- ===== C. _get_track_audio_features (NULL-safe + fallback) =====
create or replace function public._get_track_audio_features(p_track_id uuid)
returns table (
  energy           numeric,
  speechiness      numeric,
  instrumentalness numeric,
  acousticness     numeric
)
language sql
stable parallel safe
as $$
  select
    af.energy as energy,
    coalesce(
      af.speechiness,
      case when t.instrumental = true then 0.05 else null end
    ) as speechiness,
    coalesce(
      af.instrumentalness,
      case when ta.instrumentalness is not null then ta.instrumentalness::numeric / 100 else null end,
      case when t.instrumental = true then 0.90 else null end
    ) as instrumentalness,
    af.acousticness as acousticness
  from public.tracks t
  left join public.track_audio_features af on af.track_id = t.id
  left join public.track_analysis ta on ta.track_id = t.id
  where t.id = p_track_id;
$$;

-- ===== D. _check_store_profile =====
-- 반환: { conditions_total, conditions_evaluated, conditions_passed, conditions_violated,
--         score_delta, severity, violations[], bonuses[] }
create or replace function public._check_store_profile(p_track_id uuid, p_store_slug text)
returns jsonb
language plpgsql
stable parallel safe
as $$
declare
  prof record;
  af record;
  v_passed int := 0;
  v_violated int := 0;
  v_evaluated int := 0;
  v_total int := 0;
  v_delta numeric := 0;
  v_violations text[] := '{}';
  v_bonuses text[] := '{}';
  v_severity text := 'none';
begin
  select * into prof from public.store_audio_profiles
    where store_slug = p_store_slug and is_active;
  if prof.store_slug is null then
    return jsonb_build_object('applicable', false, 'reason', 'no_profile_for_store');
  end if;

  select * into af from public._get_track_audio_features(p_track_id);

  -- energy_max
  if prof.energy_max is not null then
    v_total := v_total + 1;
    if af.energy is not null then
      v_evaluated := v_evaluated + 1;
      if af.energy <= prof.energy_max then
        v_passed := v_passed + 1;
        v_delta := v_delta + prof.bonus_per_match;
        v_bonuses := array_append(v_bonuses, 'energy_ok:'||round(af.energy,2)::text||'<='||round(prof.energy_max,2)::text);
      else
        v_violated := v_violated + 1;
        v_delta := v_delta - prof.penalty_per_violation;
        v_violations := array_append(v_violations, 'energy_high:'||round(af.energy,2)::text||'>'||round(prof.energy_max,2)::text);
      end if;
    end if;
  end if;

  -- energy_min
  if prof.energy_min is not null then
    v_total := v_total + 1;
    if af.energy is not null then
      v_evaluated := v_evaluated + 1;
      if af.energy >= prof.energy_min then
        v_passed := v_passed + 1;
        v_delta := v_delta + prof.bonus_per_match;
        v_bonuses := array_append(v_bonuses, 'energy_ok:'||round(af.energy,2)::text||'>='||round(prof.energy_min,2)::text);
      else
        v_violated := v_violated + 1;
        v_delta := v_delta - prof.penalty_per_violation;
        v_violations := array_append(v_violations, 'energy_low:'||round(af.energy,2)::text||'<'||round(prof.energy_min,2)::text);
      end if;
    end if;
  end if;

  -- speechiness_max
  if prof.speechiness_max is not null then
    v_total := v_total + 1;
    if af.speechiness is not null then
      v_evaluated := v_evaluated + 1;
      if af.speechiness <= prof.speechiness_max then
        v_passed := v_passed + 1;
        v_delta := v_delta + prof.bonus_per_match;
        v_bonuses := array_append(v_bonuses, 'speech_ok:'||round(af.speechiness,2)::text||'<='||round(prof.speechiness_max,2)::text);
      else
        v_violated := v_violated + 1;
        v_delta := v_delta - prof.penalty_per_violation;
        v_violations := array_append(v_violations, 'speech_high:'||round(af.speechiness,2)::text||'>'||round(prof.speechiness_max,2)::text);
      end if;
    end if;
  end if;

  -- instrumentalness_min
  if prof.instrumentalness_min is not null then
    v_total := v_total + 1;
    if af.instrumentalness is not null then
      v_evaluated := v_evaluated + 1;
      if af.instrumentalness >= prof.instrumentalness_min then
        v_passed := v_passed + 1;
        v_delta := v_delta + prof.bonus_per_match;
        v_bonuses := array_append(v_bonuses, 'instr_ok:'||round(af.instrumentalness,2)::text||'>='||round(prof.instrumentalness_min,2)::text);
      else
        v_violated := v_violated + 1;
        v_delta := v_delta - prof.penalty_per_violation;
        v_violations := array_append(v_violations, 'instr_low:'||round(af.instrumentalness,2)::text||'<'||round(prof.instrumentalness_min,2)::text);
      end if;
    end if;
  end if;

  -- acousticness_min
  if prof.acousticness_min is not null then
    v_total := v_total + 1;
    if af.acousticness is not null then
      v_evaluated := v_evaluated + 1;
      if af.acousticness >= prof.acousticness_min then
        v_passed := v_passed + 1;
        v_delta := v_delta + prof.bonus_per_match;
        v_bonuses := array_append(v_bonuses, 'acoust_ok:'||round(af.acousticness,2)::text||'>='||round(prof.acousticness_min,2)::text);
      else
        v_violated := v_violated + 1;
        v_delta := v_delta - prof.penalty_per_violation;
        v_violations := array_append(v_violations, 'acoust_low:'||round(af.acousticness,2)::text||'<'||round(prof.acousticness_min,2)::text);
      end if;
    end if;
  end if;

  -- Severity 판정
  if v_violated >= prof.severity_threshold then
    v_severity := 'high';
    v_delta := v_delta - 20;
  elsif v_violated > 0 then
    v_severity := case when v_evaluated > 0 and v_violated::numeric / v_evaluated >= 0.5
                       then 'medium' else 'low' end;
  end if;

  return jsonb_build_object(
    'applicable', true,
    'conditions_total', v_total,
    'conditions_evaluated', v_evaluated,
    'conditions_passed', v_passed,
    'conditions_violated', v_violated,
    'score_delta', v_delta,
    'severity', v_severity,
    'violations', v_violations,
    'bonuses', v_bonuses
  );
end; $$;

-- ===== E. _ai_compute_fit v5 — Store Profile 통합 =====
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
  v_normalized_slug text;
  v_ai_genre int := 0; v_ai_mood int := 0; v_ai_store int := 0; v_ai_boost int := 0;
  v_mood_overlap int := 0;
  v_reason_codes text[] := '{}';
  v_guardrail jsonb;
  v_gr_soft numeric := 0;
  v_gr_bonus numeric := 0;
  v_gr_hard_patterns text[];
  -- X5.2
  v_profile jsonb;
  v_sp_delta numeric := 0;
  v_sp_violated int := 0;
  v_sp_severity text;
begin
  select * into cfg from public.ai_scoring_config where id=1;
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags, ai_store_key
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;

  v_normalized_slug := public.normalize_store_label(pl.business_category);

  if public._track_is_excluded_from_playlist(p_track_id, p_playlist_id) then
    insert into public.playlist_track_fit_scores(
      playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
      reason, source, status, updated_at,
      manual_score, ai_store_score, ai_mood_score, ai_genre_score, ai_boost_total,
      normalized_store_slug, reason_codes
    ) values (
      p_playlist_id, p_track_id, 0, 0, 0, 0, 0,
      '[admin_store_exclusion] 관리자가 이 매장에서 이 트랙을 제외함',
      'algorithm', 'excluded', now(),
      0, 0, 0, 0, 0,
      v_normalized_slug,
      array['admin_store_exclusion']
    )
    on conflict (playlist_id, track_id) do update set
      fit_score = 0, audio_score = 0, metadata_score = 0, behavior_score = 0, penalty_score = 0,
      reason = '[admin_store_exclusion] 관리자가 이 매장에서 이 트랙을 제외함',
      status = case when public.playlist_track_fit_scores.source = 'admin'
                    then public.playlist_track_fit_scores.status else 'excluded' end,
      updated_at = now(),
      manual_score = 0, ai_store_score = 0, ai_mood_score = 0,
      ai_genre_score = 0, ai_boost_total = 0,
      reason_codes = array['admin_store_exclusion'];
    return;
  end if;

  -- X5.0: genre guardrail hard_block check
  if v_normalized_slug is not null then
    v_guardrail := public._check_genre_guardrail(p_track_id, v_normalized_slug);
    if (v_guardrail->>'hard_block')::boolean then
      v_gr_hard_patterns := coalesce(
        (select array_agg(x) from jsonb_array_elements_text(v_guardrail->'hard_block_patterns') x),
        '{}'::text[]);
      insert into public.playlist_track_fit_scores(
        playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
        reason, source, status, updated_at,
        manual_score, ai_store_score, ai_mood_score, ai_genre_score, ai_boost_total,
        normalized_store_slug, reason_codes
      ) values (
        p_playlist_id, p_track_id, 0, 0, 0, 0, 0,
        format('[genre_hard_block] %s 매장 배치 금지 (matched: %s)',
               v_normalized_slug, array_to_string(v_gr_hard_patterns, ',')),
        'algorithm', 'excluded', now(),
        0, 0, 0, 0, 0,
        v_normalized_slug,
        array_append(array['genre_hard_block'],
          'matched:' || array_to_string(v_gr_hard_patterns, '|'))
      )
      on conflict (playlist_id, track_id) do update set
        fit_score = 0, audio_score = 0, metadata_score = 0, behavior_score = 0, penalty_score = 0,
        reason = format('[genre_hard_block] %s 매장 배치 금지 (matched: %s)',
                        v_normalized_slug, array_to_string(v_gr_hard_patterns, ',')),
        status = case when public.playlist_track_fit_scores.source = 'admin'
                      then public.playlist_track_fit_scores.status else 'excluded' end,
        updated_at = now(),
        manual_score = 0, ai_store_score = 0, ai_mood_score = 0,
        ai_genre_score = 0, ai_boost_total = 0,
        reason_codes = array_append(array['genre_hard_block'],
          'matched:' || array_to_string(v_gr_hard_patterns, '|'));
      return;
    end if;
    v_gr_soft := coalesce((v_guardrail->>'soft_penalty_delta')::numeric, 0);
    v_gr_bonus := coalesce((v_guardrail->>'bonus_delta')::numeric, 0);
  end if;

  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;

  v_key := coalesce(nullif(btrim(pl.ai_store_key),''),
                    public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart));

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

  -- X5.0: genre guardrail soft_penalty / bonus
  if v_gr_soft < 0 then
    v_reason_codes := array_append(v_reason_codes, 'genre_soft_penalty_' || abs(v_gr_soft)::text);
  end if;
  if v_gr_bonus > 0 then
    v_reason_codes := array_append(v_reason_codes, 'genre_store_bonus_' || v_gr_bonus::text);
  end if;

  -- 🆕 X5.2: Store Profile evaluation
  if v_normalized_slug is not null then
    v_profile := public._check_store_profile(p_track_id, v_normalized_slug);
    if (v_profile->>'applicable')::boolean then
      v_sp_delta := coalesce((v_profile->>'score_delta')::numeric, 0);
      v_sp_violated := coalesce((v_profile->>'conditions_violated')::int, 0);
      v_sp_severity := v_profile->>'severity';
      if v_sp_delta <> 0 then
        v_reason_codes := array_append(v_reason_codes,
          format('store_profile_%s_%s', v_sp_severity,
                 case when v_sp_delta >= 0 then '+'||v_sp_delta::text else v_sp_delta::text end));
      end if;
      if v_sp_severity = 'high' then
        v_reason_codes := array_append(v_reason_codes,
          'store_profile_high_severity_' || v_sp_violated::text || '_violations');
      end if;
    end if;
  end if;

  v_fit := least(100, greatest(0, v_manual + v_ai_boost + v_gr_soft + v_gr_bonus + v_sp_delta));

  if v_key is not null then
    gr := public._ai_check_store_guardrails(p_track_id, v_key);
    if (gr->>'blocked')::boolean then
      v_fit := 0; v_excluded := true;
      v_reason := '[guardrail hard_block] ' || coalesce((select string_agg(e->>'reason',', ') from jsonb_array_elements(gr->'violations') e), '');
      v_reason_codes := array_append(v_reason_codes, 'guardrail_blocked');
    else
      v_gpen := coalesce((gr->>'penalty_score')::numeric, 0);
      if v_gpen > 0 then
        v_fit := greatest(0, v_fit - v_gpen);
        v_reason_codes := array_append(v_reason_codes, 'guardrail_penalty_' || round(v_gpen)::text);
      end if;
    end if;
  end if;
  if ai.track_id is not null and v_key is not null and ai.ai_exclusions @> array[v_key] then
    v_excluded := true;
    v_reason_codes := array_append(v_reason_codes, 'ai_excluded');
  end if;

  -- X5.2: severity=high → review_needed (운영자 검토용, 즉시 hide 아님)
  if v_status is null then
    v_status := case when v_excluded then 'excluded'
                     when v_fit < cfg.fit_exclude_cutoff then 'review_needed'
                     when v_sp_severity = 'high' then 'review_needed'
                     else 'active' end;
  end if;
  if v_reason is null then
    v_reason := format('audio %s · meta %s · behavior %s · penalty %s · manual %s · ai_boost +%s · gr_soft %s · gr_bonus %s · sp %s%s%s',
      round(v_audio), round(v_meta), round(v_behav), round(v_pen),
      round(v_manual), v_ai_boost, v_gr_soft, v_gr_bonus,
      v_sp_delta,
      case when v_key is not null then ' · store='||v_key else '' end,
      case when v_sp_severity is not null and v_sp_severity <> 'none'
           then ' · sp_severity='||v_sp_severity else '' end);
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
    manual_score=excluded.manual_score, ai_store_score=excluded.ai_store_score,
    ai_mood_score=excluded.ai_mood_score, ai_genre_score=excluded.ai_genre_score,
    ai_boost_total=excluded.ai_boost_total,
    normalized_store_slug=excluded.normalized_store_slug,
    reason_codes=excluded.reason_codes;
end; $$;

-- ===== F. 권한 =====
revoke all on function public._get_track_audio_features(uuid) from public, anon;
revoke all on function public._check_store_profile(uuid, text) from public, anon;
grant execute on function public._get_track_audio_features(uuid) to authenticated, service_role;
grant execute on function public._check_store_profile(uuid, text) to authenticated, service_role;
