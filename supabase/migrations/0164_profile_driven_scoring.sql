-- 0164 — store_fit/exclusions/mismatch 를 ai_store_profiles 기반으로 계산 (하드코딩 제거, v2)
-- (점수 분산 튜닝: base 38, ideal +15, genre pref +16, priority*14)

create or replace function public._ai_norm_genre(p text)
returns text language sql immutable as $$ select regexp_replace(lower(coalesce(p,'')), '[^a-z0-9]', '', 'g'); $$;

create or replace function public._ai_tag_to_store_key(p_tag text)
returns text language sql immutable as $$
  select case
    when p_tag ~* '키즈|kids|어린이' then 'kids_cafe'
    when p_tag ~* '애견|반려|강아지|dog|pet' then 'dog_cafe'
    when p_tag ~* '헬스|gym' then 'gym'
    when p_tag ~* '필라테스|pilates' then 'pilates'
    when p_tag ~* '요가|yoga' then 'yoga'
    when p_tag ~* '병원|클리닉|치과|hospital' then 'hospital'
    when p_tag ~* '프랜|프렌차이즈|프랜차이즈' then 'cafe_franchise'
    when p_tag ~* '브런치' then 'brunch_cafe'
    when p_tag ~* '카페|cafe' then 'cafe_independent'
    when p_tag ~* '칵테일|cocktail' then 'cocktail_bar'
    when p_tag ~* '와인바|와인|라운지바' then 'winebar'
    when p_tag ~* '한식' then 'korean_restaurant'
    when p_tag ~* '파인다이닝|fine' then 'fine_dining'
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
$$;

create or replace function public.recompute_track_ai_metadata(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  f record; t record; pr record;
  bpm numeric; en numeric; dnc numeric; ac numeric; inst numeric; voc numeric; br numeric; ts numeric;
  v_tgen text[]; v_mood text; v_explicit boolean;
  sc numeric; v_fit jsonb := '{}'; v_excl text[] := '{}'; v_energy text; v_conf numeric;
  v_mismatch numeric := 0; v_reasons text[] := '{}'; v_expl text; v_situ text[];
  v_excl_thr numeric; v_tag text; v_key text; v_declared int := 0; v_low int := 0;
  has_pref boolean; has_block boolean; v_clean_risk boolean;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select * into f from public.track_audio_features where track_id = p_track_id;
  select tr.id, tr.bpm as r_bpm, tr.energy_level, tr.mood, tr.main_genre, tr.genre, tr.genre_tags,
         tr.business_type_tags, tr.vocal_type, coalesce(tr.explicit_content,false) as explicit_content
    into t from public.tracks tr where tr.id = p_track_id;
  if t.id is null then raise exception 'track not found'; end if;
  select coalesce(store_exclude_threshold,25) into v_excl_thr from public.ai_scoring_config where id=1;
  if f.track_id is null or f.status <> 'done' then
    insert into public.track_ai_metadata(track_id, status, explanation, ai_energy_level)
    values (p_track_id, 'failed', '오디오 분석 미완료 — 분석 후 재계산 필요', 'unknown')
    on conflict (track_id) do update set status='failed', explanation='오디오 분석 미완료 — 분석 후 재계산 필요', updated_at=now();
    return jsonb_build_object('ok', false, 'reason', 'no_audio_features');
  end if;
  bpm := f.bpm; en := coalesce(f.energy,0.5); dnc := coalesce(f.danceability,0.5);
  ac := coalesce(f.acousticness,0.5); inst := coalesce(f.instrumentalness,0.3);
  voc := coalesce(f.vocal_presence,0.5); br := coalesce(f.brightness,0.5); ts := coalesce(f.tempo_stability,0.5);
  v_mood := lower(coalesce(t.mood,'')); v_explicit := t.explicit_content;
  select array_agg(distinct g) into v_tgen from (
    select public._ai_norm_genre(x) g from unnest(array_remove(array[t.main_genre, t.genre] || coalesce(t.genre_tags,'{}'), null)) x
    where public._ai_norm_genre(x) <> '') s;
  v_tgen := coalesce(v_tgen,'{}');
  v_energy := case when en<0.35 then 'low' when en<0.68 then 'medium' else 'high' end;
  for pr in select * from public.ai_store_profiles where active loop
    sc := 38;
    if bpm is not null then
      if pr.ideal_bpm_min is not null and bpm between pr.ideal_bpm_min and pr.ideal_bpm_max then sc := sc + 15;
      elsif pr.bpm_min is not null and bpm between pr.bpm_min and pr.bpm_max then sc := sc + 5;
      elsif pr.bpm_min is not null then sc := sc - 22; end if;
    end if;
    if pr.ideal_energy_min is not null and en between pr.ideal_energy_min and pr.ideal_energy_max then sc := sc + 15;
    elsif pr.energy_min is not null and en between pr.energy_min and pr.energy_max then sc := sc + 5;
    elsif pr.energy_min is not null then sc := sc - 22; end if;
    if pr.danceability_min is not null then sc := sc + case when dnc >= pr.danceability_min then 7 else -6 end; end if;
    if pr.acousticness_min is not null then sc := sc + case when ac >= pr.acousticness_min then 7 else -5 end; end if;
    if pr.instrumentalness_min is not null then sc := sc + case when inst >= pr.instrumentalness_min then 7 else -5 end; end if;
    if pr.vocal_presence_max is not null and voc > pr.vocal_presence_max then sc := sc - 12; end if;
    if pr.brightness_min is not null and br < pr.brightness_min then sc := sc - 5; end if;
    if pr.brightness_max is not null and br > pr.brightness_max then sc := sc - 5; end if;
    has_pref := exists (select 1 from unnest(pr.preferred_genres) g where public._ai_norm_genre(g) = any(v_tgen));
    has_block := exists (select 1 from unnest(pr.blocked_genres) g where public._ai_norm_genre(g) = any(v_tgen));
    if has_pref then sc := sc + 16; end if;
    if has_block then sc := sc - 40; end if;
    if v_mood <> '' and exists (select 1 from unnest(pr.preferred_moods) m where v_mood like '%'||lower(m)||'%') then sc := sc + 8; end if;
    if v_mood <> '' and exists (select 1 from unnest(pr.blocked_moods) m where v_mood like '%'||lower(m)||'%') then sc := sc - 25; end if;
    if pr.vocal_preference='instrumental_first' and voc>0.6 then sc := sc - 14;
    elsif pr.vocal_preference='lyrics_restricted' and voc>0.75 then sc := sc - 8;
    elsif pr.vocal_preference='vocal_preferred' and voc<0.3 then sc := sc - 6; end if;
    if not pr.allow_strong_beat and dnc>0.6 then sc := sc - 12; end if;
    if not pr.allow_drop and en>0.75 then sc := sc - 12; end if;
    sc := sc + coalesce(pr.energy_priority,0)*(en-0.5)*14;
    sc := sc + coalesce(pr.calm_priority,0)*(0.5-en)*14;
    sc := sc + coalesce(pr.trendy_priority,0)*(br-0.4)*8;
    sc := round(least(100, greatest(0, sc)));
    v_fit := v_fit || jsonb_build_object(pr.store_key, sc);
    v_clean_risk := v_explicit or has_block or exists (select 1 from unnest(array['aggressive','dark','sad','explicit']) m where v_mood like '%'||m||'%');
    if sc < v_excl_thr or (pr.require_clean_content and v_clean_risk)
       or (pr.vocal_preference='instrumental_first' and voc>0.7 and en>0.6)
       or (pr.conversation_friendly and en>0.8) or (pr.focus_friendly and (voc>0.7 or en>0.7)) then
      v_excl := array_append(v_excl, pr.store_key);
    end if;
  end loop;
  v_fit := v_fit || jsonb_build_object(
    'cafe_afternoon', coalesce(v_fit->'cafe_independent','50'::jsonb), 'cafe_morning', coalesce(v_fit->'cafe_franchise','50'::jsonb),
    'winebar_evening', coalesce(v_fit->'winebar','50'::jsonb), 'lounge', coalesce(v_fit->'hotel_lobby','50'::jsonb));
  select array_agg(s.key order by s.v desc) into v_situ from (
    select key, value::numeric v from jsonb_each_text(v_fit)
    where key not in ('cafe_afternoon','cafe_morning','winebar_evening','lounge') order by value::numeric desc limit 3) s;
  if t.business_type_tags is not null then
    foreach v_tag in array t.business_type_tags loop
      v_key := public._ai_tag_to_store_key(v_tag);
      if v_key is not null and v_fit ? v_key then
        v_declared := v_declared + 1;
        if (v_fit->>v_key)::numeric < 40 then
          v_low := v_low + 1;
          v_reasons := array_append(v_reasons, format('등록자는 %s(으)로 설정했지만 %s 적합도 %s점으로 낮습니다.', v_tag, v_key, (v_fit->>v_key)));
        end if;
        if exists (select 1 from public.ai_store_profiles p2 where p2.store_key=v_key and p2.vocal_preference='instrumental_first') and voc>0.65 and en>0.6 then
          v_reasons := array_append(v_reasons, format('%s 매장은 instrumental 선호인데 보컬/에너지가 높습니다.', v_tag));
        end if;
        if v_key='kids_cafe' and (v_explicit or v_mood ~ 'aggressive|dark|sad') then
          v_reasons := array_append(v_reasons, '키즈카페인데 explicit/공격적/어두운 분위기로 위험합니다.');
        end if;
      end if;
    end loop;
  end if;
  v_mismatch := least(1.0, (case when v_declared>0 then (v_low::numeric/v_declared)*0.6 else 0 end)
    + (case when array_length(v_reasons,1) is not null then least(0.4, (array_length(v_reasons,1)-v_low)*0.2) else 0 end));
  v_conf := case when f.analyzer in ('heuristic-v1','mock-v1') then 0.6 else 0.8 end;
  v_expl := format('에너지 %s, BPM %s. 적합 매장 상위: %s. %s', v_energy, coalesce(round(bpm)::text,'미상'),
    array_to_string(v_situ,', '),
    case when array_length(v_reasons,1) is not null then '불일치: '||array_to_string(v_reasons,' / ') else '등록 메타데이터와 큰 불일치 없음.' end);
  insert into public.track_ai_metadata(track_id, ai_genres, ai_moods, ai_situations, ai_energy_level, ai_vocal_type,
    ai_store_fit, ai_exclusions, metadata_confidence, mismatch_score, mismatch_reasons, explanation, status, analysis_version, updated_at)
  values (p_track_id, case when t.main_genre is not null then array[t.main_genre] else '{}' end,
    case when v_energy='high' then array['energetic'] when v_energy='low' then array['calm'] else '{}' end,
    coalesce(v_situ,'{}'), v_energy, t.vocal_type, v_fit, array_remove(v_excl,null), v_conf,
    round(v_mismatch::numeric,3), v_reasons, v_expl, 'done', 'v2', now())
  on conflict (track_id) do update set ai_moods=excluded.ai_moods, ai_situations=excluded.ai_situations,
    ai_energy_level=excluded.ai_energy_level, ai_store_fit=excluded.ai_store_fit, ai_exclusions=excluded.ai_exclusions,
    metadata_confidence=excluded.metadata_confidence, mismatch_score=excluded.mismatch_score,
    mismatch_reasons=excluded.mismatch_reasons, explanation=excluded.explanation,
    status=case when public.track_ai_metadata.status='reviewed' then 'reviewed' else 'done' end, analysis_version='v2', updated_at=now();
  return jsonb_build_object('ok', true, 'store_fit', v_fit, 'mismatch_score', round(v_mismatch::numeric,3), 'energy', v_energy, 'exclusions', to_jsonb(array_remove(v_excl,null)));
end; $$;

alter table public.playlists add column if not exists ai_store_key text;

create or replace function public._ai_playlist_store_key(p_business text, p_category text, p_daypart text)
returns text language sql immutable as $$
  select case
    when p_business ~* '헬스|gym' or p_category ~* '헬스|gym' then 'gym'
    when p_business ~* '필라테스' or p_category ~* '필라테스' then 'pilates'
    when p_business ~* '요가|yoga' or p_category ~* '요가|yoga' then 'yoga'
    when p_business ~* '병원|클리닉' or p_category ~* '병원|클리닉' then 'hospital'
    when p_business ~* '브런치' or p_category ~* '브런치' then 'brunch_cafe'
    when p_business ~* '프랜|프렌' or p_category ~* '프랜|프렌' then 'cafe_franchise'
    when p_business ~* '카페|cafe' or p_category ~* '카페|cafe' then 'cafe_independent'
    when p_business ~* '칵테일' or p_category ~* '칵테일' then 'cocktail_bar'
    when p_business ~* '와인|라운지' or p_category ~* '와인|라운지' then 'winebar'
    when p_business ~* '한식' or p_category ~* '한식' then 'korean_restaurant'
    when p_business ~* '파인다이닝' or p_category ~* '파인다이닝' then 'fine_dining'
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
$$;

create or replace function public._ai_compute_fit(p_playlist_id uuid, p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  pl record; ai record; t record; cfg record;
  v_key text; v_audio numeric; v_meta numeric; v_behav numeric; v_pen numeric; v_fit numeric;
  v_status text; v_reason text; v_excluded boolean := false;
begin
  select * into cfg from public.ai_scoring_config where id=1;
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags, ai_store_key
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;
  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;
  v_key := coalesce(nullif(btrim(pl.ai_store_key),''), public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart));
  if ai.track_id is not null and v_key is not null and ai.ai_store_fit ? v_key then
    v_audio := (ai.ai_store_fit->>v_key)::numeric; else v_audio := 50; end if;
  v_meta := 50 + public._ai_overlap(pl.genre_tags, t.genre_tags)*8 + public._ai_overlap(pl.mood_tags, t.mood_tags)*8
    + (case when ai.track_id is not null then public._ai_overlap(pl.situation_tags, ai.ai_situations)*6 else 0 end)
    - (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*30 else 0 end);
  v_meta := least(100, greatest(0, v_meta));
  v_behav := public._ai_behavior_score(p_playlist_id, p_track_id);
  v_pen := (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*40 else 0 end)
    + (case when t.audio_health_status='conversion_failed' then 50 else 0 end)
    + least(30, coalesce((select count(*) from public.playlist_track_skip_events e
         where e.playlist_id=p_playlist_id and e.track_id=p_track_id and e.created_at>now()-interval '30 days' and e.played_seconds>=5),0)*5);
  v_pen := least(100, greatest(0, v_pen));
  v_fit := least(100, greatest(0, v_audio*cfg.fit_audio_w + v_meta*cfg.fit_meta_w + v_behav*cfg.fit_behavior_w - v_pen*cfg.fit_penalty_w));
  if ai.track_id is not null and v_key is not null and ai.ai_exclusions @> array[v_key] then v_excluded := true; end if;
  v_status := case when v_excluded then 'excluded' when v_fit < cfg.fit_exclude_cutoff then 'review_needed' else 'active' end;
  v_reason := format('audio %s · meta %s · behavior %s · penalty %s%s', round(v_audio), round(v_meta), round(v_behav), round(v_pen),
    case when v_key is not null then ' · store='||v_key else '' end);
  insert into public.playlist_track_fit_scores(playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score, reason, source, status, updated_at)
  values (p_playlist_id, p_track_id, round(v_fit), round(v_audio), round(v_meta), round(v_behav), round(v_pen), v_reason, 'algorithm', v_status, now())
  on conflict (playlist_id, track_id) do update set
    fit_score=excluded.fit_score, audio_score=excluded.audio_score, metadata_score=excluded.metadata_score,
    behavior_score=excluded.behavior_score, penalty_score=excluded.penalty_score, reason=excluded.reason,
    status=case when public.playlist_track_fit_scores.source='admin' then public.playlist_track_fit_scores.status else excluded.status end,
    updated_at=now();
end; $$;
