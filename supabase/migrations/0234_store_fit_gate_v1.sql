-- 0234 — Store Fit Gate v1
--
-- 문제: auto_place_track() 가 daypart + BPM + quality_score 만으로 score 30 이상이면
-- 배치 → DMON Rock 헬스장 트랙이 호텔/와인바/미용실 플레이리스트에 배치됨.
--
-- Gate:
--   score >= threshold (30, 기존)
--   AND (genre_match OR mood_match OR business_match OR ai_store_match OR allow_match)
--   AND NOT (block_match AND NOT allow_match)
--
-- 결정 분기:
--   block_match && !allow_match  → skip + flag (risk_type='genre_block_suspected')
--   !gate_passed                 → skip (조용히)
--   else                         → 배치
--
-- 자동 삭제 없음. 부적합 신호는 placement_risk_flags 로만 적재.

-- ===== auto_place_track v2 =====
create or replace function public.auto_place_track(p_track_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record; a record; r record;
  v_artist_key text;
  v_threshold numeric := 30; v_max int := 5; v_artist_cap int := 3;
  v_placed int := 0; v_cand int := 0; v_log jsonb := '[]'::jsonb;
  v_skip_block int := 0; v_skip_gate int := 0;
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
  v_artist_key := lower(btrim(coalesce(t.artist,'')));
  select count(*) into v_cand from public.playlists where is_auto_generated = true and status = 'released';

  for r in
    select p.id, p.title, p.business_category, p.ai_store_key,
      -- 점수 (기존 그대로)
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
      )::numeric as score,
      -- Gate 신호 (5개)
      ((a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
        or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x)))
        as genre_match,
      exists(select 1 from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m))
        as mood_match,
      (p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}'))))
        as business_match,
      exists(
        select 1 from public.track_ai_predictions ap
        where ap.track_id = p_track_id and ap.model_version = 'taxonomy-v1'
          and ap.predicted_store_types is not null
          and (
            (p.ai_store_key is not null and p.ai_store_key = any(ap.predicted_store_types))
            or exists(
              select 1 from public.taxonomy_store_types ts
              where ts.name_ko = p.business_category and ts.slug = any(ap.predicted_store_types)
            )
          )
      ) as ai_store_match,
      -- Allow 룰 매치
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'allow'
          and (
            position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
            or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt
                      where position(lower(gbr.genre_pattern) in lower(gt)) > 0)
          )
      )) as allow_match,
      -- Block 룰 매치
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'block'
          and (
            (a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
            or lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt
                      where lower(gt) like '%' || lower(gbr.genre_pattern) || '%')
          )
      )) as block_match,
      -- 매치된 block pattern (플래그 reason 용)
      (select string_agg(distinct gbr.genre_pattern, ',')
       from public.genre_block_rules gbr
       where gbr.business_category = p.business_category and gbr.block_kind = 'block'
         and (
           (a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
           or lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
           or lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
           or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt
                     where lower(gt) like '%' || lower(gbr.genre_pattern) || '%')
         )
      ) as matched_block_pattern
    from public.playlists p
    where p.is_auto_generated = true and p.status = 'released'
    order by score desc
  loop
    exit when v_placed >= v_max or r.score < v_threshold;

    -- 1) block + no allow → skip + flag (멱등 — UNIQUE constraint 보장)
    if r.block_match and not r.allow_match then
      begin
        insert into public.placement_risk_flags (
          playlist_id, track_id, risk_type, risk_reason,
          business_category, main_genre, matched_pattern, match_score
        ) values (
          r.id, p_track_id, 'genre_block_suspected',
          format('block rule matched: main_genre=%s × business=%s pattern=%s (score %s)',
                 t.main_genre, r.business_category, coalesce(r.matched_block_pattern,'?'), round(r.score,1)),
          r.business_category, t.main_genre,
          coalesce(r.matched_block_pattern,''), round(r.score,1)
        )
        on conflict (playlist_id, track_id, risk_type) do nothing;
      exception when others then null; -- 플래그 실패해도 배치 진행 흐름 영향 없음
      end;
      v_skip_block := v_skip_block + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
                                            'decision', 'skip_blocked',
                                            'block_pattern', r.matched_block_pattern);
      continue;
    end if;

    -- 2) minimum gate
    if not (r.genre_match or r.mood_match or r.business_match or r.ai_store_match or r.allow_match) then
      v_skip_gate := v_skip_gate + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
                                            'decision', 'skip_gate_failed');
      continue;
    end if;

    -- 3) artist cap
    if v_artist_key <> '' and (
      select count(*) from public.playlist_tracks pt join public.tracks tt on tt.id = pt.track_id
      where pt.playlist_id = r.id and lower(btrim(coalesce(tt.artist,''))) = v_artist_key
    ) >= v_artist_cap then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'artist_cap');
      continue;
    end if;

    -- 4) 배치
    begin
      insert into public.playlist_tracks(playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
      values (r.id, p_track_id,
        coalesce((select max(order_index)+1 from public.playlist_tracks where playlist_id = r.id), 0),
        round(r.score,1),
        format('자동 배치 (score %s · gate: %s)',
          round(r.score,1),
          array_to_string(array_remove(array[
            case when r.genre_match then 'genre' end,
            case when r.mood_match then 'mood' end,
            case when r.business_match then 'business' end,
            case when r.ai_store_match then 'ai_store' end,
            case when r.allow_match then 'allow' end
          ], null), '+')),
        'auto');
      v_placed := v_placed + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
                                            'decision', 'auto_place');
    exception when unique_violation then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'already_placed');
    end;
  end loop;

  insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
  values (p_track_id, case when v_placed > 0 then 'placed' else 'review' end, v_cand, v_placed,
          v_log || jsonb_build_object('skip_blocked', v_skip_block, 'skip_gate_failed', v_skip_gate));
  return jsonb_build_object('ok', true, 'placed', v_placed, 'candidates', v_cand,
    'skip_blocked', v_skip_block, 'skip_gate_failed', v_skip_gate,
    'status', case when v_placed > 0 then 'placed' else 'review' end);
end; $$;

-- ===== admin_explain_placement v2 — gate 필드 추가 =====
create or replace function public.admin_explain_placement(p_track_id uuid, p_playlist_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_t record; v_a record; v_p record;
  v_genre numeric := 0; v_mood numeric := 0; v_business numeric := 0;
  v_daypart numeric := 0; v_bpm numeric := 0; v_energy numeric := 0;
  v_vocal numeric := 0; v_quality numeric := 0; v_freshness numeric := 0;
  v_block_reasons text[]; v_allow_exc text[];
  v_total numeric;
  v_genre_match boolean := false;
  v_mood_match boolean := false;
  v_business_match boolean := false;
  v_ai_store_match boolean := false;
  v_allow_match boolean := false;
  v_block_match boolean := false;
  v_gate_reasons text[] := '{}';
  v_final_decision text;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  select * into v_t from public.tracks where id = p_track_id;
  if not found then raise exception 'track not found: %', p_track_id; end if;
  select * into v_p from public.playlists where id = p_playlist_id;
  if not found then raise exception 'playlist not found: %', p_playlist_id; end if;
  select * into v_a from public.track_analysis where track_id = p_track_id;

  v_genre_match := (v_a.genre is not null and exists(select 1 from unnest(v_p.genre_tags) g where lower(g)=lower(v_a.genre)))
                   or exists(select 1 from unnest(v_p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(v_t.genre_tags,'{}'::text[])) x));
  v_mood_match := exists(select 1 from unnest(v_p.mood_tags) m where m = any(v_a.mood_tags) or lower(coalesce(v_t.mood,'')) = lower(m));
  v_business_match := v_p.business_category is not null
                      and (v_t.suitable_store = v_p.business_category or v_p.business_category = any(coalesce(v_t.business_tags,'{}'::text[])));
  v_ai_store_match := exists(
    select 1 from public.track_ai_predictions ap
    where ap.track_id = p_track_id and ap.model_version = 'taxonomy-v1'
      and ap.predicted_store_types is not null
      and (
        (v_p.ai_store_key is not null and v_p.ai_store_key = any(ap.predicted_store_types))
        or exists(select 1 from public.taxonomy_store_types ts
                  where ts.name_ko = v_p.business_category and ts.slug = any(ap.predicted_store_types))
      )
  );

  v_genre := case when v_genre_match then 25 else 0 end;
  v_mood := coalesce((select count(*) from unnest(v_p.mood_tags) m where m = any(v_a.mood_tags) or lower(coalesce(v_t.mood,'')) = lower(m)) * 15, 0);
  v_business := case when v_business_match then 20 else 0 end;
  v_daypart := coalesce(case when v_p.daypart is not null and (v_p.daypart = any(coalesce(v_t.time_slots,'{}'::text[])) or 'all' = any(coalesce(v_t.time_slots,'{}'::text[]))) then 10 else 0 end, 0);
  v_bpm := coalesce(case when v_p.bpm_min is not null and v_a.bpm is not null then (case when v_a.bpm between v_p.bpm_min and coalesce(v_p.bpm_max,9999) then 10 else -10 end) else 0 end, 0);
  v_energy := coalesce(case when v_p.energy_min is not null and v_a.energy is not null then (case when v_a.energy between v_p.energy_min and coalesce(v_p.energy_max,100) then 10 else -5 end) else 0 end, 0);
  v_vocal := coalesce(case when v_p.vocal_preference='vocal' then (case when coalesce(v_t.instrumental,false) then -10 else 10 end)
                            when v_p.vocal_preference='instrumental' then (case when coalesce(v_t.instrumental,false) then 10 else -10 end)
                            else 0 end, 0);
  v_quality := coalesce(v_a.quality_score - 70, 0);
  v_freshness := case when v_t.created_at >= now() - interval '30 days' then 5 else 0 end;

  if v_p.business_category is not null then
    select array_agg(gbr.genre_pattern || ' → ' || gbr.reason)
      into v_block_reasons
    from public.genre_block_rules gbr
    where gbr.business_category = v_p.business_category and gbr.block_kind = 'block'
      and (
        (v_a.genre is not null and position(lower(gbr.genre_pattern) in lower(v_a.genre)) > 0)
        or lower(coalesce(v_t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
        or lower(coalesce(v_t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
        or exists(select 1 from unnest(coalesce(v_t.genre_tags,'{}'::text[])) gt where lower(gt) like '%' || lower(gbr.genre_pattern) || '%')
      );
    select array_agg(gbr.genre_pattern || ' → ' || gbr.reason)
      into v_allow_exc
    from public.genre_block_rules gbr
    where gbr.business_category = v_p.business_category and gbr.block_kind = 'allow'
      and (
        position(lower(gbr.genre_pattern) in lower(coalesce(v_t.main_genre,''))) > 0
        or position(lower(gbr.genre_pattern) in lower(coalesce(v_t.sub_genre,''))) > 0
        or exists(select 1 from unnest(coalesce(v_t.genre_tags,'{}'::text[])) gt where position(lower(gbr.genre_pattern) in lower(gt)) > 0)
      );
    v_block_match := v_block_reasons is not null and array_length(v_block_reasons,1) > 0;
    v_allow_match := v_allow_exc is not null and array_length(v_allow_exc,1) > 0;
  end if;

  v_total := v_genre + v_mood + v_business + v_daypart + v_bpm + v_energy + v_vocal + v_quality + v_freshness;

  if v_genre_match then v_gate_reasons := v_gate_reasons || 'genre_match'; end if;
  if v_mood_match then v_gate_reasons := v_gate_reasons || 'mood_match'; end if;
  if v_business_match then v_gate_reasons := v_gate_reasons || 'business_match'; end if;
  if v_ai_store_match then v_gate_reasons := v_gate_reasons || 'ai_store_match'; end if;
  if v_allow_match then v_gate_reasons := v_gate_reasons || 'allow_match'; end if;

  -- 결정 분기
  if v_block_match and not v_allow_match then
    v_final_decision := 'skip_blocked';      -- block + no allow → flag + skip
  elsif v_total < 30 then
    v_final_decision := 'skip_below_threshold';
  elsif array_length(v_gate_reasons,1) is null then
    v_final_decision := 'skip_gate_failed';
  else
    v_final_decision := 'auto_place';
  end if;

  return jsonb_build_object(
    'track', jsonb_build_object('id', v_t.id, 'title', v_t.title, 'artist', v_t.artist,
      'manual_main_genre', v_t.main_genre, 'manual_sub_genre', v_t.sub_genre,
      'manual_mood', v_t.mood, 'manual_mood_tags', v_t.mood_tags,
      'suitable_store', v_t.suitable_store, 'time_slots', v_t.time_slots,
      'genre_tags', v_t.genre_tags),
    'analysis', case when v_a is null then null else jsonb_build_object(
      'genre', v_a.genre, 'mood_tags', v_a.mood_tags, 'energy', v_a.energy,
      'bpm', v_a.bpm, 'quality_score', v_a.quality_score) end,
    'playlist', jsonb_build_object('id', v_p.id, 'title', v_p.title,
      'business_category', v_p.business_category, 'daypart', v_p.daypart,
      'genre_tags', v_p.genre_tags, 'mood_tags', v_p.mood_tags,
      'bpm_min', v_p.bpm_min, 'bpm_max', v_p.bpm_max,
      'energy_min', v_p.energy_min, 'energy_max', v_p.energy_max,
      'ai_store_key', v_p.ai_store_key),
    'scores', jsonb_build_object(
      'genre', v_genre, 'mood', v_mood, 'business', v_business, 'daypart', v_daypart,
      'bpm', v_bpm, 'energy', v_energy, 'vocal', v_vocal,
      'quality', v_quality, 'freshness', v_freshness, 'exclude_penalty', 0),
    'block_reasons', v_block_reasons,
    'allow_exceptions', v_allow_exc,
    'final_score', v_total,
    'threshold', 30,
    'would_place', v_final_decision = 'auto_place',
    -- 🆕 Store Fit Gate v1 필드
    'gate', jsonb_build_object(
      'genre_match', v_genre_match,
      'mood_match', v_mood_match,
      'business_match', v_business_match,
      'ai_store_match', v_ai_store_match,
      'allow_rule_matched', v_allow_match,
      'block_rule_matched', v_block_match,
      'minimum_gate_passed', array_length(v_gate_reasons,1) is not null,
      'gate_reasons', v_gate_reasons,
      'final_decision', v_final_decision
    ),
    'metadata_source', 'manual_main_genre',
    'ai_prediction_taxonomy_v1', (
      select jsonb_build_object('main', predicted_main_genre, 'subs', predicted_sub_genres,
                                'confidence', genre_confidence, 'applied_at', applied_at,
                                'predicted_store_types', predicted_store_types)
      from public.track_ai_predictions where track_id = p_track_id and model_version = 'taxonomy-v1'
    )
  );
end; $$;
revoke all on function public.admin_explain_placement(uuid, uuid) from public, anon;
grant execute on function public.admin_explain_placement(uuid, uuid) to authenticated, service_role;

-- ===== admin_simulate_auto_placement — dry-run (no INSERT) =====
-- 트랙이 새 게이트로 어디에 배치/차단/skip 될지 시뮬레이션. 회귀 테스트 / UI 디버그 용.
create or replace function public.admin_simulate_auto_placement(p_track_id uuid)
returns table (
  playlist_id uuid, playlist_title text, business_category text,
  score numeric,
  genre_match boolean, mood_match boolean, business_match boolean,
  ai_store_match boolean, allow_match boolean, block_match boolean,
  decision text,
  block_pattern text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_t record; v_a record;
  v_threshold numeric := 30;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select * into v_t from public.tracks where id = p_track_id;
  if not found then raise exception 'track not found: %', p_track_id; end if;
  select * into v_a from public.track_analysis where track_id = p_track_id;

  return query
  with cands as (
    select p.id, p.title, p.business_category, p.ai_store_key,
      (
        coalesce(case when (v_a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(v_a.genre)))
                       or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(v_t.genre_tags,'{}')) x))
                  then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(p.mood_tags) m where m = any(v_a.mood_tags) or lower(coalesce(v_t.mood,'')) = lower(m)) * 15, 0)
      + coalesce(case when p.business_category is not null and (v_t.suitable_store = p.business_category or p.business_category = any(coalesce(v_t.business_tags,'{}'))) then 20 else 0 end,0)
      + coalesce(case when p.daypart is not null and (p.daypart = any(coalesce(v_t.time_slots,'{}')) or 'all' = any(coalesce(v_t.time_slots,'{}'))) then 10 else 0 end,0)
      + coalesce(case when p.bpm_min is not null and v_a.bpm is not null then (case when v_a.bpm between p.bpm_min and coalesce(p.bpm_max,9999) then 10 else -10 end) else 0 end,0)
      + coalesce(case when p.energy_min is not null and v_a.energy is not null then (case when v_a.energy between p.energy_min and coalesce(p.energy_max,100) then 10 else -5 end) else 0 end,0)
      + coalesce(case when p.vocal_preference='vocal' then (case when coalesce(v_t.instrumental,false) then -10 else 10 end)
                      when p.vocal_preference='instrumental' then (case when coalesce(v_t.instrumental,false) then 10 else -10 end)
                      else 0 end,0)
      + coalesce(v_a.quality_score - 70, 0)
      + case when v_t.created_at >= now() - interval '30 days' then 5 else 0 end
      )::numeric as sc,
      ((v_a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(v_a.genre)))
        or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(v_t.genre_tags,'{}')) x))) as g_match,
      exists(select 1 from unnest(p.mood_tags) m where m = any(v_a.mood_tags) or lower(coalesce(v_t.mood,'')) = lower(m)) as m_match,
      (p.business_category is not null and (v_t.suitable_store = p.business_category or p.business_category = any(coalesce(v_t.business_tags,'{}')))) as b_match,
      exists(
        select 1 from public.track_ai_predictions ap
        where ap.track_id = p_track_id and ap.model_version = 'taxonomy-v1' and ap.predicted_store_types is not null
          and ((p.ai_store_key is not null and p.ai_store_key = any(ap.predicted_store_types))
            or exists(select 1 from public.taxonomy_store_types ts where ts.name_ko = p.business_category and ts.slug = any(ap.predicted_store_types)))
      ) as ai_match,
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'allow'
          and (position(lower(gbr.genre_pattern) in lower(coalesce(v_t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(v_t.sub_genre,''))) > 0
            or exists(select 1 from unnest(coalesce(v_t.genre_tags,'{}'::text[])) gt where position(lower(gbr.genre_pattern) in lower(gt)) > 0))
      )) as al_match,
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'block'
          and ((v_a.genre is not null and position(lower(gbr.genre_pattern) in lower(v_a.genre)) > 0)
            or lower(coalesce(v_t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or lower(coalesce(v_t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or exists(select 1 from unnest(coalesce(v_t.genre_tags,'{}'::text[])) gt where lower(gt) like '%' || lower(gbr.genre_pattern) || '%'))
      )) as bl_match,
      (select string_agg(distinct gbr.genre_pattern, ',') from public.genre_block_rules gbr
       where gbr.business_category = p.business_category and gbr.block_kind = 'block'
         and ((v_a.genre is not null and position(lower(gbr.genre_pattern) in lower(v_a.genre)) > 0)
           or lower(coalesce(v_t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
           or lower(coalesce(v_t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%')) as bl_pat
    from public.playlists p
    where p.is_auto_generated = true and p.status = 'released'
  )
  select c.id, c.title, c.business_category, c.sc,
    c.g_match, c.m_match, c.b_match, c.ai_match, c.al_match, c.bl_match,
    case
      when c.sc < v_threshold then 'skip_below_threshold'
      when c.bl_match and not c.al_match then 'skip_blocked'
      when not (c.g_match or c.m_match or c.b_match or c.ai_match or c.al_match) then 'skip_gate_failed'
      else 'auto_place'
    end as decision,
    c.bl_pat
  from cands c
  order by c.sc desc;
end; $$;
revoke all on function public.admin_simulate_auto_placement(uuid) from public, anon;
grant execute on function public.admin_simulate_auto_placement(uuid) to authenticated, service_role;
