-- 0189 — 음식점 업종 세분화 (한식/일식/중식/양식/다이닝/이자카야/술집).
-- store_key 매핑 + ai_store_profiles + store_guardrails(archetype) + 업종별 flow 가중치 + 레거시 재분류 플래그.
-- additive. stream_events/정산/차트/playlist_tracks 미수정.

create unique index if not exists uq_ai_store_profiles_store_key on public.ai_store_profiles(store_key);

insert into public.ai_store_profiles (store_key, store_label, bpm_min, bpm_max, ideal_bpm_min, ideal_bpm_max,
  energy_min, energy_max, ideal_energy_min, ideal_energy_max, preferred_moods, vocal_preference,
  conversation_friendly, luxury_mood, calm_priority, energy_priority, sort_order, description)
values
  ('japanese_restaurant','일식당', 70,120, 80,110, 0.30,0.70, 0.35,0.60, array['stylish','dreamy','nostalgic','calm'], 'vocal_allowed', true, false, 4, 2, 41, '일식 — 시티팝/재즈홉/로파이, 잔잔·세련'),
  ('chinese_restaurant','중식당', 80,125, 90,118, 0.40,0.80, 0.45,0.70, array['lively','upbeat','warm'], 'vocal_allowed', true, false, 1, 4, 42, '중식 — 업비트 팝/재즈/펑크, 식사 흐름 유지'),
  ('western_restaurant','양식당', 60,115, 70,105, 0.25,0.65, 0.30,0.55, array['classy','luxury','calm'], 'vocal_allowed', true, true, 4, 1, 43, '양식 — 재즈/피아노/클래식 크로스오버/라운지'),
  ('izakaya','이자카야', 75,120, 80,112, 0.30,0.72, 0.38,0.62, array['night','emotional','cozy','urban'], 'vocal_allowed', true, false, 3, 3, 44, '이자카야 — 심야 감성, 시티팝/로파이/재즈홉'),
  ('pub','술집', 85,135, 95,128, 0.45,0.95, 0.55,0.85, array['energetic','groovy','lively'], 'vocal_allowed', false, false, 0, 5, 45, '술집 — 텐션/그루브, 힙합/RNB/팝/하우스 (과도한 aggressive 제외)')
on conflict (store_key) do update set
  store_label=excluded.store_label, bpm_min=excluded.bpm_min, bpm_max=excluded.bpm_max,
  ideal_bpm_min=excluded.ideal_bpm_min, ideal_bpm_max=excluded.ideal_bpm_max,
  energy_min=excluded.energy_min, energy_max=excluded.energy_max,
  ideal_energy_min=excluded.ideal_energy_min, ideal_energy_max=excluded.ideal_energy_max,
  preferred_moods=excluded.preferred_moods, conversation_friendly=excluded.conversation_friendly,
  luxury_mood=excluded.luxury_mood, calm_priority=excluded.calm_priority, energy_priority=excluded.energy_priority,
  sort_order=excluded.sort_order, description=excluded.description, updated_at=now();

create or replace function public._ai_tag_to_store_key(p_tag text)
returns text language sql immutable as $function$
  select case
    when p_tag ~* '키즈|kids|어린이' then 'kids_cafe'
    when p_tag ~* '애견|반려|강아지|dog|pet' then 'dog_cafe'
    when p_tag ~* '헬스|gym' then 'gym'
    when p_tag ~* '필라테스|pilates' then 'pilates'
    when p_tag ~* '요가|yoga' then 'yoga'
    when p_tag ~* '병원|클리닉|치과|hospital' then 'hospital'
    when p_tag ~* '이자카야|izakaya' then 'izakaya'
    when p_tag ~* '술집|펍|호프|pub' then 'pub'
    when p_tag ~* '브런치' then 'brunch_cafe'
    when p_tag ~* '프랜|프렌차이즈|프랜차이즈' then 'cafe_franchise'
    when p_tag ~* '카페|cafe' then 'cafe_independent'
    when p_tag ~* '칵테일|cocktail' then 'cocktail_bar'
    when p_tag ~* '와인바|와인|라운지바' then 'winebar'
    when p_tag ~* '파인다이닝|다이닝|fine.?dining|dining' then 'fine_dining'
    when p_tag ~* '한식|korean' then 'korean_restaurant'
    when p_tag ~* '일식|일본식|japanese' then 'japanese_restaurant'
    when p_tag ~* '중식|중국식|chinese' then 'chinese_restaurant'
    when p_tag ~* '양식|이탈리안|프렌치|western|european' then 'western_restaurant'
    when p_tag ~* '한식당|korean_restaurant' then 'korean_restaurant'
    when p_tag ~* '식당|레스토랑|restaurant' then 'restaurant'
    when p_tag ~* '코워킹|coworking|공유오피스' then 'coworking'
    when p_tag ~* '사무실|오피스|업무|office' then 'office'
    when p_tag ~* '네일' then 'nail_shop'
    when p_tag ~* '미용실|살롱|헤어|salon' then 'salon'
    when p_tag ~* '호텔|hotel' then 'hotel_lobby'
    when p_tag ~* '편집샵|편집|쇼룸|select' then 'select_shop'
    when p_tag ~* '의류|패션|옷가게|clothing' then 'clothing_store'
    when p_tag ~* 'pc방|피시방|pcbang' then 'pc_bang'
    when p_tag ~* '플라워|꽃' then 'select_shop'
    else null
  end;
$function$;

delete from public.store_guardrails where store_key in ('japanese_restaurant','chinese_restaurant','western_restaurant','izakaya','pub');
insert into public.store_guardrails (store_key, rule_key, rule_type, operator, value, severity, reason) values
  ('japanese_restaurant','max_bpm','numeric','>','125','soft_block','일식은 잔잔/세련'),
  ('japanese_restaurant','max_energy','numeric','>','0.78','soft_block','일식 과한 에너지'),
  ('japanese_restaurant','banned_genre','genre','contains','trap','hard_block','트랩 부적합'),
  ('japanese_restaurant','banned_genre','genre','contains','hardstyle','hard_block','하드스타일 부적합'),
  ('chinese_restaurant','min_energy','numeric','<','0.30','soft_block','중식 너무 잔잔'),
  ('chinese_restaurant','max_bpm','numeric','>','130','soft_block','중식 과한 BPM'),
  ('chinese_restaurant','banned_genre','genre','contains','hardstyle','hard_block','하드스타일 부적합'),
  ('western_restaurant','max_bpm','numeric','>','118','soft_block','양식 과한 BPM'),
  ('western_restaurant','max_energy','numeric','>','0.70','soft_block','양식 과한 에너지'),
  ('western_restaurant','banned_genre','genre','contains','trap','hard_block','트랩 부적합'),
  ('western_restaurant','banned_genre','genre','contains','edm','hard_block','EDM 부적합'),
  ('izakaya','max_bpm','numeric','>','125','soft_block','이자카야 과한 BPM'),
  ('izakaya','max_energy','numeric','>','0.80','soft_block','이자카야 과한 에너지'),
  ('izakaya','banned_genre','genre','contains','hardstyle','hard_block','하드스타일 부적합'),
  ('izakaya','banned_genre','genre','contains','dubstep','hard_block','덥스텝 부적합'),
  ('pub','min_bpm','numeric','<','80','soft_block','술집 너무 느림'),
  ('pub','min_energy','numeric','<','0.40','soft_block','술집 너무 잔잔'),
  ('pub','banned_genre','genre','contains','hardstyle','hard_block','하드코어 부적합'),
  ('pub','max_bpm','numeric','>','140','soft_block','술집 과한 BPM');

insert into public.store_guardrails (store_key, rule_key, rule_type, operator, value, severity, reason)
select * from (values
  ('fine_dining','banned_genre','genre','contains','trap','hard_block','다이닝 트랩 금지'),
  ('fine_dining','max_vocal_presence','numeric','>','0.85','soft_block','다이닝 강한 보컬 지양')
) v(store_key,rule_key,rule_type,operator,value,severity,reason)
where not exists (select 1 from public.store_guardrails g where g.store_key='fine_dining' and g.rule_key=v.rule_key and g.value=v.value);

insert into public.store_guardrails (store_key, rule_key, rule_type, operator, value, severity, reason)
select 'korean_restaurant','banned_genre','genre','contains','trap','hard_block','한식 aggressive trap 금지'
where not exists (select 1 from public.store_guardrails g where g.store_key='korean_restaurant' and g.rule_key='banned_genre' and g.value='trap');

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

create or replace function public._flow_weights(p_store_key text)
returns jsonb language sql immutable as $function$
  select case p_store_key
    when 'fine_dining'        then '{"bpm":32,"energy":18,"bright":8,"vocal":24,"drop":18,"mood":0,"fatigue_mult":1.4,"monotony_mult":0.7}'::jsonb
    when 'western_restaurant' then '{"bpm":26,"energy":18,"bright":12,"vocal":20,"drop":14,"mood":10,"fatigue_mult":1.2,"monotony_mult":0.8}'::jsonb
    when 'pub'                then '{"bpm":16,"energy":14,"bright":10,"vocal":12,"drop":28,"mood":0,"fatigue_mult":0.8,"monotony_mult":1.8}'::jsonb
    when 'izakaya'            then '{"bpm":18,"energy":26,"bright":18,"vocal":12,"drop":16,"mood":10,"fatigue_mult":1.0,"monotony_mult":0.8}'::jsonb
    when 'korean_restaurant'  then '{"bpm":22,"energy":24,"bright":14,"vocal":14,"drop":16,"mood":10,"fatigue_mult":1.1,"monotony_mult":0.9}'::jsonb
    when 'japanese_restaurant' then '{"bpm":20,"energy":24,"bright":16,"vocal":12,"drop":16,"mood":12,"fatigue_mult":1.0,"monotony_mult":0.9}'::jsonb
    when 'chinese_restaurant' then '{"bpm":18,"energy":20,"bright":12,"vocal":12,"drop":18,"mood":10,"fatigue_mult":0.9,"monotony_mult":1.2}'::jsonb
    else '{"bpm":22,"energy":24,"bright":12,"vocal":14,"drop":16,"mood":12,"fatigue_mult":1.0,"monotony_mult":1.0}'::jsonb
  end;
$function$;

-- 레거시 "음식점(restaurant)" 곡 세부 업종 재분류 플래그 (자동확정 금지)
create or replace function public.admin_flag_restaurant_reclassify()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_n int := 0; v_sug text; v_g text;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in
    select t.id, t.main_genre, t.genre, t.genre_tags, (m.ai_moods)[1] ai_mood, f.energy
    from public.tracks t
    left join public.track_ai_metadata m on m.track_id=t.id
    left join public.track_audio_features f on f.track_id=t.id and f.status='done'
    where t.source_type='artist_upload' and t.removed_at is null
      and exists (select 1 from unnest(coalesce(t.business_type_tags,'{}')) tag where public._ai_tag_to_store_key(tag)='restaurant')
  loop
    v_g := lower(coalesce(r.main_genre,'') || ' ' || coalesce(r.genre,'') || ' ' || array_to_string(coalesce(r.genre_tags,'{}'),' '));
    v_sug := case
      when v_g ~ 'jazz|lounge|bossa|piano|classic' then '다이닝/양식'
      when v_g ~ 'citypop|city pop|jpop|j-pop|lofi|lo-fi|jazzhop' then '이자카야/일식'
      when v_g ~ 'acoustic|ballad|folk|발라드|어쿠스틱|indie' then '한식'
      when v_g ~ 'hiphop|hip-hop|rnb|r&b|dance|house|funk|pop' or coalesce(r.energy,0) >= 0.6 then '술집/중식'
      else '세부 업종 검토' end;
    insert into public.track_rereview_flags(track_id, flag_type, reason)
    values (r.id, 'metadata_cleanup_required', format('음식점 → 세부 업종 재분류 필요 (제안: %s)', v_sug))
    on conflict (track_id, flag_type) do update set reason=excluded.reason where public.track_rereview_flags.status='open';
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'flagged', v_n);
end; $$;
grant execute on function public.admin_flag_restaurant_reclassify() to authenticated;

-- admin_compute_playlist_flow 는 _flow_weights(store_key) 사용하도록 갱신됨 (본 마이그레이션에서 CREATE OR REPLACE).
-- (전체 본문은 0180/0189 적용분과 동일 — 업종별 가중치 v_w 적용)
create or replace function public.admin_compute_playlist_flow(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r record; has_prev boolean := false;
  p_id uuid; p_bpm numeric; p_energy numeric; p_br numeric; p_vo numeric; p_md text;
  c_bpm numeric; c_energy numeric; c_br numeric; c_vo numeric; c_md text;
  d_bpm numeric; d_energy numeric; d_br numeric; d_vo numeric; v_drop numeric;
  pb numeric; pe numeric; pbr numeric; pv numeric; pd numeric; pm numeric; v_sim boolean; v_miss boolean;
  v_pen numeric; v_ts int; v_issues text[]; v_overlap int;
  v_pos int := 0; v_n int := 0; v_ntracks int := 0;
  v_sum_ts numeric := 0; v_rough int := 0; v_repeat int := 0; v_dropc int := 0; v_moodc int := 0;
  v_run int := 0; v_maxrun int := 0; v_cont numeric := 0;
  v_avg numeric; v_fatigue numeric; v_monotony numeric; v_cont_score int; v_flow int; v_title text;
  v_sk text; v_w jsonb; v_wb numeric; v_we numeric; v_wbr numeric; v_wv numeric; v_wd numeric; v_wm numeric; v_fmult numeric; v_mmult numeric;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select title into v_title from public.playlists where id = p_playlist_id;
  v_sk := public._playlist_store_key(p_playlist_id);
  v_w := public._flow_weights(coalesce(v_sk, 'default'));
  v_wb := (v_w->>'bpm')::numeric; v_we := (v_w->>'energy')::numeric; v_wbr := (v_w->>'bright')::numeric;
  v_wv := (v_w->>'vocal')::numeric; v_wd := (v_w->>'drop')::numeric; v_wm := (v_w->>'mood')::numeric;
  v_fmult := (v_w->>'fatigue_mult')::numeric; v_mmult := (v_w->>'monotony_mult')::numeric;
  delete from public.playlist_flow_transitions where playlist_id = p_playlist_id;

  for r in
    select pt.order_index, pt.track_id, f.bpm, f.energy, f.brightness, f.vocal_presence, m.ai_moods
    from public.playlist_tracks pt
    join public.tracks t on t.id = pt.track_id
    left join public.track_audio_features f on f.track_id = pt.track_id and f.status = 'done'
    left join public.track_ai_metadata m on m.track_id = pt.track_id
    where pt.playlist_id = p_playlist_id
    order by pt.order_index, pt.created_at
  loop
    v_ntracks := v_ntracks + 1; c_md := (r.ai_moods)[1];
    v_miss := (r.bpm is null or r.energy is null);
    c_bpm := coalesce(r.bpm, p_bpm, 100); c_energy := coalesce(r.energy, p_energy, 0.5);
    c_br := coalesce(r.brightness, p_br, 0.3); c_vo := coalesce(r.vocal_presence, p_vo, 0.4);
    if has_prev then
      d_bpm := abs(c_bpm - p_bpm); d_energy := abs(c_energy - p_energy); d_br := abs(c_br - p_br); d_vo := abs(c_vo - p_vo);
      v_drop := p_energy - c_energy;
      pb := least(1, d_bpm/40.0); pe := least(1, d_energy/0.40); pbr := least(1, d_br/0.35); pv := least(1, d_vo/0.50);
      pd := least(1, greatest(0, v_drop-0.30)/0.40);
      pm := 0;
      if p_md is not null and c_md is not null and p_md <> c_md then pm := 0.6; end if;
      v_sim := (d_bpm < 4 and d_energy < 0.05 and d_br < 0.04 and d_vo < 0.06);
      v_pen := pb*v_wb + pe*v_we + pbr*v_wbr + pv*v_wv + pd*v_wd + pm*v_wm;
      v_ts := round(100 - least(100, v_pen));
      v_issues := '{}';
      if v_miss then v_issues := array_append(v_issues, 'missing_features'); end if;
      if pb >= 0.6 then v_issues := array_append(v_issues, 'bpm_jump'); end if;
      if pe >= 0.6 then v_issues := array_append(v_issues, 'energy_jump'); end if;
      if pbr >= 0.6 then v_issues := array_append(v_issues, 'brightness_jump'); end if;
      if pv >= 0.6 then v_issues := array_append(v_issues, 'vocal_collision'); end if;
      if pd >= 0.5 then v_issues := array_append(v_issues, 'drop_shock'); end if;
      if pm >= 0.5 then v_issues := array_append(v_issues, 'mood_collision'); end if;
      if v_sim then v_issues := array_append(v_issues, 'repetitive_similarity'); end if;
      insert into public.playlist_flow_transitions(playlist_id, position, from_track_id, to_track_id,
        bpm_jump, energy_jump, brightness_jump, vocal_jump, energy_drop, transition_score, issues)
      values (p_playlist_id, v_pos, p_id, r.track_id, round(d_bpm,1), round(d_energy,3), round(d_br,3), round(d_vo,3), round(v_drop,3), v_ts, v_issues);
      v_sum_ts := v_sum_ts + v_ts; v_n := v_n + 1; v_pos := v_pos + 1;
      v_cont := v_cont + (d_energy*0.6 + d_br*0.4);
      if v_ts < 60 then v_rough := v_rough + 1; v_run := v_run + 1; v_maxrun := greatest(v_maxrun, v_run); else v_run := 0; end if;
      if v_sim then v_repeat := v_repeat + 1; end if;
      if pd >= 0.5 then v_dropc := v_dropc + 1; end if;
      if pm >= 0.5 then v_moodc := v_moodc + 1; end if;
    end if;
    p_id := r.track_id; p_bpm := c_bpm; p_energy := c_energy; p_br := c_br; p_vo := c_vo; p_md := c_md; has_prev := true;
  end loop;

  if v_n = 0 then
    insert into public.playlist_flow_scores(playlist_id, flow_score, n_tracks, n_transitions, computed_at)
    values (p_playlist_id, null, v_ntracks, 0, now())
    on conflict (playlist_id) do update set flow_score=null, n_tracks=excluded.n_tracks, n_transitions=0, computed_at=now(),
      avg_transition=null, rough_transitions=0, fatigue_index=0, monotony_index=0, repetitive_count=0, drop_shock_count=0, mood_collision_count=0, emotional_continuity=null, breakdown=null;
    return jsonb_build_object('ok', true, 'playlist_id', p_playlist_id, 'title', v_title, 'flow_score', null, 'n_tracks', v_ntracks, 'n_transitions', 0, 'note', '곡 2개 미만 — 흐름 평가 불가');
  end if;

  v_avg := v_sum_ts / v_n;
  v_fatigue := least(22, greatest(0, v_maxrun-1)*5 * v_fmult);
  v_monotony := least(20, (v_repeat::numeric / v_n) * 30 * v_mmult);
  v_cont_score := round(100 - least(100, (v_cont / v_n) / 0.40 * 100));
  v_flow := greatest(0, least(100, round(v_avg - v_fatigue - v_monotony)));

  insert into public.playlist_flow_scores(playlist_id, flow_score, n_tracks, n_transitions, avg_transition,
    rough_transitions, fatigue_index, monotony_index, repetitive_count, drop_shock_count, mood_collision_count, emotional_continuity, breakdown, computed_at)
  values (p_playlist_id, v_flow, v_ntracks, v_n, round(v_avg,1), v_rough, round(v_fatigue)::int, round(v_monotony)::int, v_repeat, v_dropc, v_moodc, v_cont_score,
    jsonb_build_object('store_key', v_sk, 'weights', v_w, 'max_rough_run', v_maxrun), now())
  on conflict (playlist_id) do update set
    flow_score=excluded.flow_score, n_tracks=excluded.n_tracks, n_transitions=excluded.n_transitions, avg_transition=excluded.avg_transition,
    rough_transitions=excluded.rough_transitions, fatigue_index=excluded.fatigue_index, monotony_index=excluded.monotony_index,
    repetitive_count=excluded.repetitive_count, drop_shock_count=excluded.drop_shock_count, mood_collision_count=excluded.mood_collision_count,
    emotional_continuity=excluded.emotional_continuity, breakdown=excluded.breakdown, computed_at=now();

  return jsonb_build_object('ok', true, 'playlist_id', p_playlist_id, 'title', v_title, 'store_key', v_sk,
    'flow_score', v_flow, 'n_tracks', v_ntracks, 'n_transitions', v_n, 'avg_transition', round(v_avg,1),
    'rough_transitions', v_rough, 'fatigue_index', round(v_fatigue)::int, 'monotony_index', round(v_monotony)::int,
    'repetitive_count', v_repeat, 'drop_shock_count', v_dropc, 'mood_collision_count', v_moodc, 'emotional_continuity', v_cont_score);
end; $$;
