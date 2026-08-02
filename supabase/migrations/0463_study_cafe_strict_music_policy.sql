-- 0463 — Study Cafe (스터디카페) strict music policy (Phase STUDY-CAFE-STRICT-MUSIC-POLICY-1)
--
-- 목표: 매장 업종이 study_cafe 인 경우, 공부/집중에 적합한 "극도로 차분한 무보컬" 음원만
--       재생되도록 하드 필터를 Runtime Pipeline 전 구간에 연결한다.
--       (추천 감점이 아니라 원천 차단. 후보 부족을 이유로 완화하지 않는다.)
--
-- 허용 장르 (canonical): lofi / ambient / jazz  — 그 외 모든 장르 차단 (Pop Instrumental 포함)
-- Vocal Policy: vocal 이 "명확한 false" 인 경우만 허용. vocal true/unknown/null = 차단.
-- Intensity  : energy/tempo/danceability/brightness/loudness/mood 로 "Very Calm" 판정.
--
-- 단일 판정 함수 `_study_cafe_track_eligible(track)` 를 만들고, 기존 런타임 진입점에 연결한다:
--   1) _ai_check_store_guardrails  → 후보 풀(_ai_compute_fit) + 재생 큐(get_playlist_tracks(uuid,uuid))
--   2) _brand_generate_playlist    → 브랜드 플레이어 큐
--   3) _check_store_genre_placement → 자동 배치(placement) 게이트
-- 새 알고리즘/우회 로직을 만들지 않고, 기존 hard-block 경로에 study_cafe 분기만 추가한다.
--
-- 안전/회귀:
--   - study_cafe 외 매장은 기존 동작 100% 무변경 (모든 분기는 store_key='study_cafe' 조건부)
--   - 기존 업종/장르 taxonomy/데이터 변형 없음 (additive · idempotent · create-or-replace)
--   - TS 순수 코어 src/lib/studyCafePolicy.ts 와 임계값/장르셋/보컬 상태를 1:1 로 맞춘다.
--   - Production DB 직접 수정 없음 — 배포 파이프라인이 마이그레이션으로 반영.

-- ============================================================================
-- A. Store-type 라우팅 — study_cafe 로 정확히 매핑
-- ============================================================================
-- A-1) 슬러그 자체를 alias 로 등록 (normalize_store_label('study_cafe') = 'study_cafe').
--   store_type_alias 서브시스템(0240)이 없는 환경에서도 안전하도록 존재 시에만 적용.
do $$ begin
  if to_regclass('public.store_type_alias') is not null then
    insert into public.store_type_alias(raw_label, taxonomy_slug, source) values
      ('study_cafe', 'study_cafe', 'seed')
    on conflict (raw_label) do update set taxonomy_slug = excluded.taxonomy_slug, is_active = true;
  end if;
end $$;

-- A-2) _ai_playlist_store_key 에 study_cafe 분기 추가.
--   주의: '스터디카페' 는 '카페' 를 포함하므로 반드시 '카페|cafe' 분기보다 먼저 판정한다.
--   (기존: 스터디카페 → cafe_independent 로 오분류. 수정 후: study_cafe.)
create or replace function public._ai_playlist_store_key(p_business text, p_category text, p_daypart text)
returns text language sql immutable as $function$
  select case
    when p_business ~* '헬스|gym' or p_category ~* '헬스|gym' then 'gym'
    when p_business ~* '필라테스' or p_category ~* '필라테스' then 'pilates'
    when p_business ~* '요가|yoga' or p_category ~* '요가|yoga' then 'yoga'
    when p_business ~* '병원|클리닉' or p_category ~* '병원|클리닉' then 'hospital'
    when p_business ~* '이자카야|izakaya' or p_category ~* '이자카야|izakaya' then 'izakaya'
    when p_business ~* '술집|펍|호프|pub' or p_category ~* '술집|펍|호프|pub' then 'pub'
    when p_business ~* '브런치' or p_category ~* '브런치' then 'brunch_cafe'
    -- study_cafe 는 '카페' 매칭보다 먼저 (스터디카페/독서실/study cafe)
    when p_business ~* '스터디|독서실|study\s*cafe|study_cafe' or p_category ~* '스터디|독서실|study\s*cafe|study_cafe' then 'study_cafe'
    when p_business ~* '프랜|프렌' or p_category ~* '프랜|프렌' then 'cafe_franchise'
    when p_business ~* '카페|cafe' or p_category ~* '카페|cafe' then 'cafe_independent'
    when p_business ~* '칵테일' or p_category ~* '칵테일' then 'cocktail_bar'
    when p_business ~* '와인|라운지' or p_category ~* '와인|라운지' then 'winebar'
    when p_business ~* '파인다이닝|다이닝|dining' or p_category ~* '파인다이닝|다이닝|dining' then 'fine_dining'
    when p_business ~* '한식' or p_category ~* '한식' then 'korean_restaurant'
    when p_business ~* '일식|일본식|japanese' or p_category ~* '일식|일본식|japanese' then 'japanese_restaurant'
    when p_business ~* '중식|중국식|chinese' or p_category ~* '중식|중국식|chinese' then 'chinese_restaurant'
    when p_business ~* '양식|이탈리안|프렌치|western' or p_category ~* '양식|이탈리안|프렌치|western' then 'western_restaurant'
    when p_business ~* '식당|레스토랑' or p_category ~* '식당|레스토랑' then 'restaurant'
    when p_business ~* '코워킹' or p_category ~* '코워킹' then 'coworking'
    when p_business ~* '사무실|오피스|업무' or p_category ~* '사무실|오피스|업무' then 'office'
    when p_business ~* '네일' or p_category ~* '네일' then 'nail_shop'
    when p_business ~* '미용실|살롱|헤어' or p_category ~* '미용실|살롱|헤어' then 'salon'
    when p_business ~* '호텔' or p_category ~* '호텔' then 'hotel_lobby'
    when p_business ~* '편집|쇼룸|플라워' or p_category ~* '편집|쇼룸|플라워' then 'select_shop'
    when p_business ~* '의류|패션' or p_category ~* '의류|패션' then 'clothing_store'
    when p_business ~* '키즈' or p_category ~* '키즈' then 'kids_cafe'
    when p_business ~* '애견|반려' or p_category ~* '애견|반려' then 'dog_cafe'
    when p_business ~* 'pc방|피시방' or p_category ~* 'pc방|피시방' then 'pc_bang'
    else null
  end;
$function$;

-- ============================================================================
-- B. _study_cafe_track_eligible — 단일 판정 함수 (genre → vocal → calm)
--    반환: { eligible: bool, reason: text }
--    reason ∈ STUDY_CAFE_GENRE_NOT_ALLOWED / STUDY_CAFE_VOCAL_NOT_ALLOWED
--            / STUDY_CAFE_NOT_CALM_ENOUGH / STUDY_CAFE_ELIGIBLE
--    src/lib/studyCafePolicy.ts 의 evaluateStudyCafeTrack 와 임계값 동기화.
-- ============================================================================
create or replace function public._study_cafe_track_eligible(p_track_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  t record; f record; m record;
  v_tokens text[]; v_primary text; v_tok text;
  v_vt text; v_has_vocal text;  -- 'true' | 'false' | 'unknown'
  v_analyzed_no_vocal boolean; v_vt_instrumental boolean;
  v_mood text;
  -- 명시 차단 장르 (allowed family prefix 를 공유해도 차단: jazzhop/chillhop 등)
  v_hardblock constant text[] := array[
    'pop','popinstrumental','acousticpop','kpop','jpop','citypop','ballad',
    'rnb','krnb','hiphop','rap','trap','drill','rock','metal','punk',
    'edm','house','techno','trance','dubstep','electronic','synthwave','hyperpop',
    'classical','newage','cinematic','funk','soul','blues','indie','bossanova',
    'reggae','latin','kids','chillhop','jazzhop','lounge','disco'];
  v_positive constant text[] := array[
    'vocal','rap','spoken','humming','chorus','narration','vocalsample','vocalchop','voice','softvocal'];
  v_block_moods constant text[] := array[
    'dark','horror','tense','tension','aggressive','intense','angry','anxious',
    'cinematic','epic','dramatic','grand','energetic','danceable','party','exciting','uplifting','hype'];
begin
  select tr.main_genre, tr.sub_genre, tr.genre, tr.genre_tags, tr.mood,
         tr.instrumental, tr.vocal_type
    into t from public.tracks tr where tr.id = p_track_id;
  if not found then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_GENRE_NOT_ALLOWED');
  end if;
  select * into f from public.track_audio_features where track_id = p_track_id;
  select ai_moods, ai_vocal_type into m from public.track_ai_metadata where track_id = p_track_id;

  -- ── Gate 1: 장르 화이트리스트 (lofi / ambient / jazz) ──────────────────────
  select array_agg(x) into v_tokens from (
    select public._ai_norm_genre(z) x
    from unnest(array_remove(array[t.main_genre, t.sub_genre, t.genre] || coalesce(t.genre_tags,'{}'), null)) z
    where public._ai_norm_genre(z) <> '') s;
  v_tokens := coalesce(v_tokens, '{}');
  if array_length(v_tokens, 1) is null then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_GENRE_NOT_ALLOWED');  -- null/미분류
  end if;

  v_primary := coalesce(
    nullif(public._ai_norm_genre(t.main_genre), ''),
    nullif(public._ai_norm_genre(t.genre), ''),
    nullif(public._ai_norm_genre(t.sub_genre), ''));
  if v_primary is null
     or v_primary = any(v_hardblock)
     or not (v_primary like 'lofi%' or v_primary like 'ambient%' or v_primary like 'ambience%' or v_primary like 'jazz%') then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_GENRE_NOT_ALLOWED');
  end if;
  -- 모든 장르 신호가 허용 family 여야 함 (복수 장르 중 미허용 → 차단)
  foreach v_tok in array v_tokens loop
    if v_tok = any(v_hardblock)
       or not (v_tok like 'lofi%' or v_tok like 'ambient%' or v_tok like 'ambience%' or v_tok like 'jazz%') then
      return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_GENRE_NOT_ALLOWED');
    end if;
  end loop;

  -- ── Gate 2: Vocal = 명확한 false 만 허용 ───────────────────────────────────
  v_vt := public._ai_norm_genre(coalesce(t.vocal_type, m.ai_vocal_type));
  v_analyzed_no_vocal := (f.vocal_presence is not null and f.vocal_presence <= 0.15);
  v_vt_instrumental := (v_vt in ('instrumental','none'));

  if v_vt <> '' and v_vt = any(v_positive) then
    v_has_vocal := 'true';
  elsif f.vocal_presence is not null and f.vocal_presence > 0.15 then
    v_has_vocal := 'true';
  elsif f.speechiness is not null and f.speechiness > 0.2 then
    v_has_vocal := 'true';
  elsif t.instrumental is true and (v_vt_instrumental or v_analyzed_no_vocal) then
    v_has_vocal := 'false';
  elsif v_vt_instrumental and v_analyzed_no_vocal then
    v_has_vocal := 'false';
  elsif v_vt_instrumental and f.instrumentalness is not null and f.instrumentalness >= 0.7 then
    v_has_vocal := 'false';
  else
    v_has_vocal := 'unknown';
  end if;

  if v_has_vocal <> 'false' then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_VOCAL_NOT_ALLOWED', 'detail', v_has_vocal);
  end if;

  -- ── Gate 3: 극도로 차분한 음악만 (Very Calm) ──────────────────────────────
  if f.track_id is null or f.energy is null then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_NOT_CALM_ENOUGH', 'detail', 'no_intensity');
  end if;
  if f.energy > 0.5 then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_NOT_CALM_ENOUGH', 'detail', 'energy');
  end if;
  if f.bpm is not null and f.bpm > 110 then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_NOT_CALM_ENOUGH', 'detail', 'tempo');
  end if;
  if f.danceability is not null and f.danceability > 0.6 then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_NOT_CALM_ENOUGH', 'detail', 'danceable');
  end if;
  if f.brightness is not null and f.brightness > 0.72 then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_NOT_CALM_ENOUGH', 'detail', 'brightness');
  end if;
  if f.loudness is not null and f.loudness > -7 then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_NOT_CALM_ENOUGH', 'detail', 'loudness');
  end if;
  v_mood := lower(coalesce(t.mood,'') || ' ' || array_to_string(coalesce(m.ai_moods,'{}'), ' '));
  if v_mood <> '' and exists (select 1 from unnest(v_block_moods) bm where v_mood like '%'||bm||'%') then
    return jsonb_build_object('eligible', false, 'reason', 'STUDY_CAFE_NOT_CALM_ENOUGH', 'detail', 'mood');
  end if;

  return jsonb_build_object('eligible', true, 'reason', 'STUDY_CAFE_ELIGIBLE');
end; $function$;

revoke all on function public._study_cafe_track_eligible(uuid) from public, anon;
grant execute on function public._study_cafe_track_eligible(uuid) to authenticated, service_role;
comment on function public._study_cafe_track_eligible(uuid) is
  '0463 — Study cafe hard filter: genre(lofi/ambient/jazz) → vocal(confirmed false) → very-calm. {eligible,reason}.';

-- ============================================================================
-- C. _ai_check_store_guardrails — study_cafe 하드 블록 분기 추가.
--    후보 풀(_ai_compute_fit) + 재생 큐(get_playlist_tracks(uuid,uuid)) 가 이 함수를 호출한다.
--    study_cafe 는 override 로도 우회 불가 (§9) — override 체크보다 먼저 판정.
--    기존 0208 본문을 그대로 유지하고 study_cafe 분기만 상단에 추가.
-- ============================================================================
create or replace function public._ai_check_store_guardrails(p_track_id uuid, p_store_key text)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  f record; t record; m record; g record;
  v_tgen text[]; v_mood text; fv numeric; viol boolean; hit boolean;
  v_violations jsonb := '[]'::jsonb; v_pen numeric := 0; v_max_sev text := null; v_blocked boolean := false;
  v_sc jsonb;
begin
  -- 🆕 0463: study_cafe strict — override/일반 룰보다 먼저, 부적합 시 즉시 hard_block.
  if p_store_key = 'study_cafe' or p_store_key like 'study\_cafe%' then
    v_sc := public._study_cafe_track_eligible(p_track_id);
    if not coalesce((v_sc->>'eligible')::boolean, false) then
      return jsonb_build_object(
        'passed', false, 'blocked', true, 'severity', 'hard_block',
        'violations', jsonb_build_array(jsonb_build_object(
          'rule_key', 'study_cafe_strict', 'severity', 'hard_block', 'reason', v_sc->>'reason')),
        'penalty_score', 100, 'overridden', false);
    end if;
    -- eligible → 아래 일반 store_guardrails 룰 통과(스터디카페 전용 룰은 없음) 후 pass 반환.
  end if;

  if exists (select 1 from public.store_guardrail_overrides o where o.track_id=p_track_id and o.store_key=p_store_key) then
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

  for g in select * from public.store_guardrails where store_key=p_store_key and enabled loop
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

revoke all on function public._ai_check_store_guardrails(uuid, text) from public, anon;
grant execute on function public._ai_check_store_guardrails(uuid, text) to authenticated, service_role;

-- ============================================================================
-- D. _check_store_genre_placement — study_cafe strict 분기 추가 (자동 배치 게이트).
--    0291(boutique) 본문 유지 + study_cafe strict 우선 판정.
--    store_genre_placement 서브시스템(0258/0268/0290/0291)이 없는 환경에서는 건너뛴다
--    (핵심 Runtime 하드필터는 _ai_check_store_guardrails/_brand_generate_playlist 가 담당).
-- ============================================================================
do $D$ begin
  if to_regclass('public.store_genre_placement_rules') is not null
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='_normalize_genre_for_md') then
    execute $ddl$
create or replace function public._check_store_genre_placement(
  p_track_id uuid, p_store_slug text
) returns jsonb language sql stable parallel safe as $$
  with t as (
    select main_genre, sub_genre,
           coalesce(instrumental, false) as is_inst,
           vocal_type,
           coalesce(vocal_presence, 0) as vp
    from public.tracks where id = p_track_id
  ),
  -- 🆕 0463: 스터디카페 strict — genre/vocal/calm 단일 판정 재사용
  study_cafe_check as (
    select case
      when p_store_slug <> 'study_cafe' then null
      when not coalesce((public._study_cafe_track_eligible(p_track_id)->>'eligible')::boolean, false)
        then public._study_cafe_track_eligible(p_track_id)->>'reason'
      else null
    end as reject_reason
  ),
  -- X6.4: 병원 strict — 가사/사람 목소리 흔적 전면 차단
  hospital_voice_check as (
    select case
      when p_store_slug <> 'hospital' then null
      when not (select is_inst from t) then 'hospital_strict_vocal_blocked'
      when (select vocal_type from t) in ('vocal','rap','spoken') then 'hospital_strict_vocal_type_blocked'
      when (select vp from t) > 0 then 'hospital_strict_vocal_presence_blocked'
      else null
    end as reject_reason
  ),
  -- X6.5: 편집샵 strict — instrumental=false 차단
  boutique_voice_check as (
    select case
      when p_store_slug <> 'boutique' then null
      when not (select is_inst from t) then 'boutique_strict_vocal_blocked'
      else null
    end as reject_reason
  ),
  norm as (
    select
      public._normalize_genre_for_md(t.main_genre) as mg,
      public._normalize_genre_for_md(t.sub_genre)  as sg,
      t.is_inst
    from t
  ),
  store_has_rules as (
    select exists (select 1 from public.store_genre_placement_rules
                   where store_type = p_store_slug) as ok
  ),
  matched as (
    select r.is_allowed, r.priority, r.genre, r.vocal_policy
    from public.store_genre_placement_rules r, norm n
    where r.store_type = p_store_slug
      and (
        public._normalize_genre_for_md(r.genre) = n.mg
        or public._normalize_genre_for_md(r.genre) = n.sg
        or n.mg like public._normalize_genre_for_md(r.genre) || '%'
        or public._normalize_genre_for_md(r.genre) like n.mg || '%'
      )
      and (
        (r.vocal_policy = 'instrumental' and n.is_inst = true)
        or (r.vocal_policy = 'vocal' and n.is_inst = false)
      )
    order by r.priority asc, r.is_allowed asc, length(r.genre) desc
    limit 1
  )
  select case
    -- 스터디카페 strict 거부 (최우선)
    when (select reject_reason from study_cafe_check) is not null then
      jsonb_build_object(
        'has_store_policy', true, 'matched', false, 'allowed', false, 'priority', 1,
        'reason', (select reject_reason from study_cafe_check)
      )
    -- 병원 strict 거부
    when (select reject_reason from hospital_voice_check) is not null then
      jsonb_build_object(
        'has_store_policy', true, 'matched', false, 'allowed', false, 'priority', 1,
        'reason', (select reject_reason from hospital_voice_check)
      )
    -- 편집샵 strict 거부
    when (select reject_reason from boutique_voice_check) is not null then
      jsonb_build_object(
        'has_store_policy', true, 'matched', false, 'allowed', false, 'priority', 1,
        'reason', (select reject_reason from boutique_voice_check)
      )
    else
      jsonb_build_object(
        'has_store_policy', (select ok from store_has_rules),
        'matched', exists (select 1 from matched),
        'allowed', coalesce((select is_allowed from matched), false),
        'priority', coalesce((select priority from matched), 100),
        'matched_genre', (select genre from matched),
        'matched_vocal_policy', (select vocal_policy from matched),
        'reason', case
          when not (select ok from store_has_rules) then 'md_policy_undefined_store'
          when exists (select 1 from matched where is_allowed) then 'md_policy_allow'
          when exists (select 1 from matched where not is_allowed) then 'md_policy_explicit_block'
          else 'md_policy_no_match'
        end
      )
  end;
$$;
    $ddl$;
    revoke all on function public._check_store_genre_placement(uuid, text) from public, anon;
    grant execute on function public._check_store_genre_placement(uuid, text) to authenticated, service_role;
    raise notice '0463 D: _check_store_genre_placement study_cafe branch installed';
  else
    raise notice '0463 D: store_genre_placement subsystem absent — placement gate skipped (core runtime filter unaffected)';
  end if;
end $D$;

-- ============================================================================
-- E. _brand_generate_playlist — 브랜드 플레이어 큐: study_cafe 브랜드는 하드 필터.
--    0455 본문 유지 + study_cafe 판정 필터만 추가.
-- ============================================================================
create or replace function public._brand_generate_playlist(p_brand_id uuid, p_limit integer default 200)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb; pol public.brand_music_policies%rowtype;
  v_limit int := greatest(1, least(coalesce(p_limit,200),500));
  v_seed text := to_char((now() at time zone 'Asia/Seoul')::date,'YYYYMMDD')||':'||p_brand_id::text;
  v_industry text; v_is_study boolean; v_norm text;
begin
  select * into pol from public.brand_music_policies where brand_id = p_brand_id;
  select industry_type into v_industry from public.brand_accounts where id = p_brand_id;
  -- normalize_store_label(0240) 이 없는 환경에서도 안전: 없으면 리터럴 별칭 집합으로만 판정.
  begin
    v_norm := public.normalize_store_label(v_industry);
  exception when undefined_function then v_norm := null;
  end;
  v_is_study := coalesce(v_norm,'') = 'study_cafe'
    or lower(btrim(coalesce(v_industry,''))) in ('study_cafe','스터디카페','스터디 카페','독서실','study cafe','studycafe');

  select coalesce(jsonb_agg(sub.x order by sub.x_score desc, sub.x_rot), '[]'::jsonb) into v from (
    select jsonb_build_object(
             'id', t.id, 'title', t.title, 'artist', t.artist,
             'genre', coalesce(t.main_genre, t.genre), 'mood', t.mood,
             'audio_url', t.audio_url, 'cover_url', t.cover_url,
             'duration', t.duration, 'created_at', t.created_at) as x,
      ( (case when pol.preferred_genres is not null and lower(coalesce(t.main_genre,t.genre,'')) = any(select lower(g) from unnest(pol.preferred_genres) g) then 25 else 0 end)
      + (case when pol.preferred_moods  is not null and lower(coalesce(t.mood,''))            = any(select lower(m) from unnest(pol.preferred_moods)  m) then 15 else 0 end) )::numeric as x_score,
      ('x'||substr(md5(t.id::text||v_seed),1,8))::bit(32)::bigint as x_rot
    from public.tracks t
    where t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and (t.release_status = 'released' or t.release_status is null)
      and t.removed_at is null
      and (t.visibility_status is null or t.visibility_status in ('approved','public'))
      and (pol.vocal_policy is null or pol.vocal_policy <> 'instrumental_only'
           or t.instrumental is true or t.lyric_type = 'instrumental' or t.vocal_type = 'instrumental')
      and (pol.energy_min is null or t.energy_level is null or t.energy_level >= pol.energy_min)
      and (pol.energy_max is null or t.energy_level is null or t.energy_level <= pol.energy_max)
      and not (pol.blocked_genres is not null and lower(coalesce(t.main_genre,t.genre,'')) = any(select lower(g) from unnest(pol.blocked_genres) g))
      and not (pol.blocked_moods  is not null and lower(coalesce(t.mood,''))            = any(select lower(m) from unnest(pol.blocked_moods)  m))
      -- 🆕 0463: study_cafe 브랜드는 스터디카페 하드 필터 통과분만 큐 진입 (fallback 없음)
      and (not v_is_study or coalesce((public._study_cafe_track_eligible(t.id)->>'eligible')::boolean, false))
    limit v_limit
  ) sub;
  return v;
end$function$;

revoke all on function public._brand_generate_playlist(uuid, integer) from public, anon;

-- ============================================================================
-- F. store_genre_placement_rules — study_cafe 허용 장르 시드 (관리자 가시성/배치 일관성).
--    Runtime hard filter 는 _study_cafe_track_eligible 가 담당하므로 보조적.
-- ============================================================================
do $$ begin
  if to_regclass('public.store_genre_placement_rules') is not null then
    insert into public.store_genre_placement_rules
      (store_type, genre, vocal_policy, is_allowed, priority, source) values
      ('study_cafe','lofi','instrumental',   true, 10, 'study_cafe_strict'),
      ('study_cafe','ambient','instrumental',true, 10, 'study_cafe_strict'),
      ('study_cafe','jazz','instrumental',   true, 10, 'study_cafe_strict')
    on conflict (store_type, genre, vocal_policy) do update set
      is_allowed = excluded.is_allowed, priority = excluded.priority, source = excluded.source;
  end if;
end $$;

-- ============================================================================
-- G. admin_get_study_cafe_policy_summary — 관리자/HQ 정책 확인 보드 (§11).
--    반환: 업종/허용장르/vocal/intensity/candidate policy + eligible/blocked 카운트.
-- ============================================================================
create or replace function public.admin_get_study_cafe_policy_summary()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_eligible int := 0; v_blocked int := 0;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  select
    count(*) filter (where (public._study_cafe_track_eligible(t.id)->>'eligible')::boolean),
    count(*) filter (where not (public._study_cafe_track_eligible(t.id)->>'eligible')::boolean)
  into v_eligible, v_blocked
  from public.tracks t
  where t.removed_at is null
    and (t.release_status = 'released' or t.release_status is null)
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0;

  return jsonb_build_object(
    'store_type', 'study_cafe',
    'store_type_label', '스터디카페',
    'allowed_genres', jsonb_build_array('Lo-fi','Ambient / Ambience','Jazz'),
    'vocal_policy', '무보컬 전용',
    'music_intensity', 'Very Calm',
    'candidate_policy', 'Strict',
    'eligible_track_count', v_eligible,
    'blocked_track_count', v_blocked
  );
end; $function$;

revoke all on function public.admin_get_study_cafe_policy_summary() from public, anon;
grant execute on function public.admin_get_study_cafe_policy_summary() to authenticated;

-- ============================================================================
-- H. Diagnostics
-- ============================================================================
do $$
declare v_fn boolean; v_key text;
begin
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_study_cafe_track_eligible') into v_fn;
  select public._ai_playlist_store_key('스터디카페', null, null) into v_key;
  raise notice '====== 0463 Study Cafe Strict Music Policy ======';
  raise notice '_study_cafe_track_eligible present: %', v_fn;
  raise notice 'store_key(스터디카페) = % (expected study_cafe)', v_key;
  if v_fn and v_key = 'study_cafe' then
    raise notice '0463 COMPLETE — study_cafe wired into candidate pool / queue / brand player / placement';
  else
    raise warning '0463 INCOMPLETE — 위 진단 확인';
  end if;
end $$;
