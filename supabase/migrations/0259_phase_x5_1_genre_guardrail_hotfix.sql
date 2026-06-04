-- 0259 — Phase X5.1 Genre Guardrail Hotfix
--
-- 목표:
--   1) _check_genre_guardrail — 하이픈 정규화 매칭 (J-Pop ↔ JPOP 등)
--   2) auto_place_track — X5 가드레일 통합 (hard_block skip / soft penalty / bonus)
--   3) get_playlist_tracks — fit_status='excluded' 자동 숨김 (review_needed 는 유지)
--
-- 배경 (진단 결과):
--   - 사용자 플레이어가 fit_score.status 를 무시 → X5 가 메타데이터만 마킹
--   - auto_place_track 이 genre_block_rules (X1 유물) 만 참조, X5 무시
--   - JPOP/KPOP/HipHop 패턴이 J-Pop/K-Pop/Hip-Hop (하이픈) 매칭 못함

-- ===== A. _check_genre_guardrail — 정규화 매칭 =====
create or replace function public._check_genre_guardrail(p_track_id uuid, p_store_slug text)
returns jsonb
language sql
stable
parallel safe
as $$
  with t as (
    select coalesce(main_genre,'') as mg, coalesce(sub_genre,'') as sg,
           coalesce(genre_tags, '{}'::text[]) as gt
    from public.tracks where id = p_track_id
  ),
  -- 정규화: lowercase + remove hyphens
  norm as (
    select replace(lower(mg),'-','') as mg_n,
           replace(lower(sg),'-','') as sg_n,
           (select array_agg(replace(lower(x),'-','')) from unnest(gt) x) as gt_n
    from t
  ),
  matched as (
    select g.rule_type, g.genre_pattern, g.score_delta,
           replace(lower(g.genre_pattern),'-','') as pattern_n
    from public.genre_store_guardrails g, norm n
    where g.is_active and g.store_slug = p_store_slug
      and (
        n.mg_n like '%' || replace(lower(g.genre_pattern),'-','') || '%'
        or n.sg_n like '%' || replace(lower(g.genre_pattern),'-','') || '%'
        or exists (
          select 1 from unnest(coalesce(n.gt_n,'{}'::text[])) tag
          where tag like '%' || replace(lower(g.genre_pattern),'-','') || '%'
        )
      )
  )
  select jsonb_build_object(
    'hard_block', exists (select 1 from matched where rule_type='hard_block'),
    'hard_block_patterns', coalesce(
      (select array_agg(distinct genre_pattern) from matched where rule_type='hard_block'),
      '{}'::text[]),
    'soft_penalty_delta', coalesce(
      (select sum(score_delta) from matched where rule_type='soft_penalty'), 0),
    'soft_penalty_patterns', coalesce(
      (select array_agg(distinct genre_pattern) from matched where rule_type='soft_penalty'),
      '{}'::text[]),
    'bonus_delta', coalesce(
      (select sum(score_delta) from matched where rule_type='bonus'), 0),
    'bonus_patterns', coalesce(
      (select array_agg(distinct genre_pattern) from matched where rule_type='bonus'),
      '{}'::text[])
  );
$$;

revoke all on function public._check_genre_guardrail(uuid, text) from public, anon;
grant execute on function public._check_genre_guardrail(uuid, text) to authenticated, service_role;

-- ===== B. auto_place_track — X5 통합 =====
-- 변경 사항:
--   1. playlist 별로 X5 가드레일 평가 (normalize_store_label(business_category) 기준)
--   2. hard_block 매칭 → skip (placement_risk_flags 기록 + log 'skip_genre_hard_block')
--   3. soft_penalty 매칭 → score 감산
--   4. bonus 매칭 → score 가산
--   5. threshold 재평가 후 결정
create or replace function public.auto_place_track(p_track_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t record; a record; r record; pred record;
  v_artist_key text;
  v_threshold numeric := 30; v_max int := 5; v_artist_cap int := 3;
  v_placed int := 0; v_cand int := 0; v_log jsonb := '[]'::jsonb;
  v_skip_block int := 0; v_skip_gate int := 0; v_skip_excl int := 0;
  v_skip_genre_hard int := 0;
  v_pl_slug text;
  v_gr jsonb;
  v_gr_soft numeric;
  v_gr_bonus numeric;
  v_score_adj numeric;
begin
  select * into t from public.tracks where id = p_track_id;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'track_not_found'); end if;
  if coalesce(t.audio_url,'') = '' or not (t.release_status = 'released' or t.release_status is null) then
    insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
      values (p_track_id,'skipped',0,0, jsonb_build_object('reason','not_released_or_no_audio'));
    return jsonb_build_object('ok', true, 'status', 'skipped');
  end if;

  perform public.derive_track_analysis(p_track_id);
  select * into a from public.track_analysis where track_id = p_track_id;
  select * into pred from public.track_ai_predictions
    where track_id = p_track_id and model_version = 'taxonomy-v1';
  v_artist_key := lower(btrim(coalesce(t.artist,'')));
  select count(*) into v_cand from public.playlists where is_auto_generated = true and status = 'released';

  select count(*) into v_skip_excl
  from public.playlists p
  where p.is_auto_generated = true and p.status = 'released'
    and public._track_is_excluded_from_playlist(p_track_id, p.id);

  for r in
    select p.id, p.title, p.business_category, p.ai_store_key,
      (
        coalesce(case when (a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
                       or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))
                  then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) * 15, 0)
      + coalesce(case when p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}'))) then 20 else 0 end,0)
      + coalesce(case when p.daypart is not null and (p.daypart = any(coalesce(t.time_slots,'{}')) or 'all' = any(coalesce(t.time_slots,'{}'))) then 10 else 0 end,0)
      + coalesce(case when p.bpm_min is not null and a.bpm is not null then (case when a.bpm between p.bpm_min and coalesce(p.bpm_max,9999) then 10 else -10 end) else 0 end,0)
      + coalesce(case when p.energy_min is not null and a.energy is not null then (case when a.energy between p.energy_min and coalesce(p.energy_max,100) then 10 else -5 end) else 0 end,0)
      + coalesce(case when p.vocal_preference='vocal' then (case when coalesce(t.instrumental,false) then -10 else 10 end)
                      when p.vocal_preference='instrumental' then (case when coalesce(t.instrumental,false) then 10 else -10 end)
                      else 0 end,0)
      + coalesce(a.quality_score - 70, 0)
      + case when t.created_at >= now() - interval '30 days' then 5 else 0 end
      + coalesce(case when pred.predicted_main_genre is not null
                       and exists(select 1 from unnest(p.genre_tags) g
                                  where lower(g) = lower(pred.predicted_main_genre))
                  then 5 else 0 end, 0)
      + coalesce(least(
          (select count(*) from unnest(coalesce(pred.predicted_moods,'{}'::text[])) pm
           join public.taxonomy_moods tm on tm.slug = pm
           where tm.name_ko = any(coalesce(p.mood_tags,'{}'::text[]))) * 3,
          9), 0)
      + coalesce(least(
          (select count(*) from unnest(coalesce(pred.predicted_store_types,'{}'::text[])) ps
           join public.taxonomy_store_types ts on ts.slug = ps
           where ts.name_ko = p.business_category) * 10,
          20), 0)
      )::numeric as score,
      ((a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
        or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))) as genre_match,
      exists(select 1 from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) as mood_match,
      (p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}')))) as business_match,
      exists(
        select 1 from public.track_ai_predictions ap
        where ap.track_id = p_track_id and ap.model_version = 'taxonomy-v1' and ap.predicted_store_types is not null
          and ((p.ai_store_key is not null and p.ai_store_key = any(ap.predicted_store_types))
            or exists(select 1 from public.taxonomy_store_types ts where ts.name_ko = p.business_category and ts.slug = any(ap.predicted_store_types)))
      ) as ai_store_match,
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'allow'
          and (position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
            or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt where position(lower(gbr.genre_pattern) in lower(gt)) > 0))
      )) as allow_match,
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'block'
          and ((a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
            or lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt where lower(gt) like '%' || lower(gbr.genre_pattern) || '%'))
      )) as block_match,
      (select string_agg(distinct gbr.genre_pattern, ',') from public.genre_block_rules gbr
       where gbr.business_category = p.business_category and gbr.block_kind = 'block'
         and ((a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
           or lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
           or lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%')) as matched_block_pattern
    from public.playlists p
    where p.is_auto_generated = true and p.status = 'released'
      and not public._track_is_excluded_from_playlist(p_track_id, p.id)
    order by score desc
  loop
    exit when v_placed >= v_max or r.score < v_threshold;

    -- X1 genre_block_rules (legacy)
    if r.block_match and not r.allow_match then
      begin
        insert into public.placement_risk_flags (playlist_id, track_id, risk_type, risk_reason,
          business_category, main_genre, matched_pattern, match_score)
        values (r.id, p_track_id, 'genre_block_suspected',
          format('block rule matched: main_genre=%s × business=%s pattern=%s (score %s)',
                 t.main_genre, r.business_category, coalesce(r.matched_block_pattern,'?'), round(r.score,1)),
          r.business_category, t.main_genre, coalesce(r.matched_block_pattern,''), round(r.score,1))
        on conflict (playlist_id, track_id, risk_type) do nothing;
      exception when others then null;
      end;
      v_skip_block := v_skip_block + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'decision', 'skip_blocked');
      continue;
    end if;

    -- 🆕 X5.1: genre_store_guardrails 통합
    v_pl_slug := public.normalize_store_label(r.business_category);
    v_score_adj := r.score;
    if v_pl_slug is not null then
      v_gr := public._check_genre_guardrail(p_track_id, v_pl_slug);
      if (v_gr->>'hard_block')::boolean then
        begin
          insert into public.placement_risk_flags (playlist_id, track_id, risk_type, risk_reason,
            business_category, main_genre, matched_pattern, match_score)
          values (r.id, p_track_id, 'genre_hard_block',
            format('X5 genre_hard_block: %s × %s (patterns: %s)',
                   t.main_genre, v_pl_slug,
                   coalesce((select string_agg(p, ',') from jsonb_array_elements_text(v_gr->'hard_block_patterns') p), '?')),
            r.business_category, t.main_genre,
            coalesce((select string_agg(p, ',') from jsonb_array_elements_text(v_gr->'hard_block_patterns') p), ''),
            round(r.score,1))
          on conflict (playlist_id, track_id, risk_type) do nothing;
        exception when others then null;
        end;
        v_skip_genre_hard := v_skip_genre_hard + 1;
        v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
                                             'decision', 'skip_genre_hard_block',
                                             'patterns', v_gr->'hard_block_patterns');
        continue;
      end if;
      v_gr_soft := coalesce((v_gr->>'soft_penalty_delta')::numeric, 0);
      v_gr_bonus := coalesce((v_gr->>'bonus_delta')::numeric, 0);
      v_score_adj := r.score + v_gr_soft + v_gr_bonus;
      -- 가드레일 적용 후 threshold 재평가
      if v_score_adj < v_threshold then
        v_log := v_log || jsonb_build_object('playlist', r.title, 'orig_score', round(r.score,1),
                                             'adj_score', round(v_score_adj,1),
                                             'decision', 'skip_below_threshold_after_guardrail',
                                             'soft', v_gr_soft, 'bonus', v_gr_bonus);
        continue;
      end if;
    end if;

    if not (r.genre_match or r.mood_match or r.business_match or r.ai_store_match or r.allow_match) then
      v_skip_gate := v_skip_gate + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'decision', 'skip_gate_failed');
      continue;
    end if;
    if v_artist_key <> '' and (
      select count(*) from public.playlist_tracks pt join public.tracks tt on tt.id = pt.track_id
      where pt.playlist_id = r.id and lower(btrim(coalesce(tt.artist,''))) = v_artist_key
    ) >= v_artist_cap then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'artist_cap');
      continue;
    end if;
    begin
      insert into public.playlist_tracks(playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
      values (r.id, p_track_id,
        coalesce((select max(order_index)+1 from public.playlist_tracks where playlist_id = r.id), 0),
        round(v_score_adj,1),
        format('자동 배치 X5.1 (score %s%s · gate: %s)',
          round(v_score_adj,1),
          case when v_score_adj <> r.score
               then format(' [orig %s · gr_soft %s · gr_bonus %s]', round(r.score,1), v_gr_soft, v_gr_bonus)
               else '' end,
          array_to_string(array_remove(array[
            case when r.genre_match then 'genre' end,
            case when r.mood_match then 'mood' end,
            case when r.business_match then 'business' end,
            case when r.ai_store_match then 'ai_store' end,
            case when r.allow_match then 'allow' end
          ], null), '+')),
        'auto');
      v_placed := v_placed + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(v_score_adj,1), 'decision', 'auto_place');
    exception when unique_violation then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'already_placed');
    end;
  end loop;

  insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
  values (p_track_id, case when v_placed > 0 then 'placed' else 'review' end, v_cand, v_placed,
          v_log || jsonb_build_object(
            'skip_blocked', v_skip_block,
            'skip_gate_failed', v_skip_gate,
            'skip_admin_exclusion', v_skip_excl,
            'skip_genre_hard_block', v_skip_genre_hard));
  return jsonb_build_object('ok', true, 'placed', v_placed, 'candidates', v_cand,
    'skip_blocked', v_skip_block, 'skip_gate_failed', v_skip_gate,
    'skip_admin_exclusion', v_skip_excl, 'skip_genre_hard_block', v_skip_genre_hard,
    'status', case when v_placed > 0 then 'placed' else 'review' end);
end; $function$;

-- ===== C. get_playlist_tracks — status='excluded' 숨김 =====
-- review_needed 는 유지 (사용자 결정에 따른 운영자 검토 대기)
create or replace function public.get_playlist_tracks(p_playlist_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v jsonb; v_sk text;
begin
  v_sk := public._playlist_store_key(p_playlist_id);
  select coalesce(jsonb_agg(to_jsonb(t) order by pt.order_index), '[]'::jsonb) into v
  from public.playlist_tracks pt
  join public.tracks t on t.id = pt.track_id
  left join public.playlist_track_fit_scores f
    on f.playlist_id = pt.playlist_id and f.track_id = pt.track_id
  where pt.playlist_id = p_playlist_id
    and t.release_status in ('released','approved') and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
    and not public._business_track_excluded(t.id, v_sk)
    -- 🆕 X5.1: fit_score status='excluded' 숨김 (review_needed 는 유지)
    and (f.status is null or f.status <> 'excluded');
  return v;
end; $function$;
