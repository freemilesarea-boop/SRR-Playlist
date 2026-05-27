-- legacy tracks.genre 참조 제거 (컬럼 DROP 전 안전 상태 확보).
-- genre 는 현재 파이프라인에서 항상 비어 있어 모든 변경은 의미상 no-op:
--   coalesce(main_genre, genre) → main_genre,  array[main_genre, genre]||genre_tags → array[main_genre]||genre_tags
-- additive: CREATE OR REPLACE 만. 데이터 UPDATE 없음. tracks.genre 컬럼 미DROP. release_status/stream_events·정산 무접근.

-- 1) get_personalized_recommendations : 장르 선호 키/출력에서 genre 폴백 제거 → main_genre
create or replace function public.get_personalized_recommendations(p_limit integer default 12)
returns table(track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, score numeric, reason text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_total numeric := 0; v_mg numeric; v_mm numeric; v_ma numeric;
begin
  if v_uid is not null then
    perform public.refresh_user_music_preferences(v_uid);
    select coalesce(sum(p.score),0) into v_total from public.user_music_preferences p where p.user_id=v_uid;
  end if;

  if v_uid is null or v_total < 5 then
    return query
    with cand as (
      select t.*, coalesce((select count(*) from public.stream_events se where se.track_id=t.id and se.event_type='milestone_30s'),0) pop
      from public.tracks t
      where t.visibility_status='approved' and (t.release_status='released' or t.source_type='admin_upload')
        and t.removed_at is null and coalesce(t.is_recommendable,true)=true
        and t.audio_url is not null and length(btrim(t.audio_url))>0
        and t.cover_url is not null and length(btrim(t.cover_url))>0
    ), ranked as (
      select c.*, row_number() over (partition by c.owner_user_id order by c.created_at desc) rn from cand c
    )
    select r.id, r.title, r.artist, r.main_genre, r.mood, r.cover_url, r.audio_url, r.duration,
           round((0.5*(case when r.created_at>now()-interval '21 days' then 1 else 0.3 end) + 0.5*least(r.pop::numeric/20,1) + 0.05*r.recommendation_priority),4),
           '인기·신곡 추천'::text
    from ranked r where rn <= 2
    order by 9 desc, r.created_at desc limit p_limit;
    return;
  end if;

  select max(p.score) into v_mg from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='genre';
  select max(p.score) into v_mm from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='mood';
  select max(p.score) into v_ma from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='artist';

  return query
  with cand as (
    select t.*,
      coalesce((select g.score from public.user_music_preferences g where g.user_id=v_uid and g.preference_type='genre' and g.preference_key=t.main_genre),0) gsc,
      coalesce((select m.score from public.user_music_preferences m where m.user_id=v_uid and m.preference_type='mood' and m.preference_key=t.mood),0) msc,
      coalesce((select a.score from public.user_music_preferences a where a.user_id=v_uid and a.preference_type='artist' and a.preference_key=t.owner_user_id::text),0) asc_,
      coalesce((select count(*) from public.stream_events se where se.track_id=t.id and se.event_type='milestone_30s'),0) pop,
      coalesce((select count(*) from public.stream_events se where se.user_id=v_uid and se.track_id=t.id and se.event_type='milestone_30s'),0) myplays
    from public.tracks t
    where t.visibility_status='approved' and (t.release_status='released' or t.source_type='admin_upload')
      and t.removed_at is null and coalesce(t.is_recommendable,true)=true
      and t.audio_url is not null and length(btrim(t.audio_url))>0
      and t.cover_url is not null and length(btrim(t.cover_url))>0
  ),
  scored as (
    select c.*,
      ( 0.35*(case when coalesce(v_mg,0)>0 then c.gsc/v_mg else 0 end)
      + 0.25*(case when coalesce(v_mm,0)>0 then c.msc/v_mm else 0 end)
      + 0.15*(case when coalesce(v_ma,0)>0 then c.asc_/v_ma else 0 end)
      + 0.15*(case when c.created_at>now()-interval '21 days' then 1 when c.created_at>now()-interval '60 days' then 0.5 else 0.1 end)
      + 0.10*least(c.pop::numeric/20,1)
      + 0.02*c.recommendation_priority
      - (case when c.myplays>=5 then 0.4 when c.myplays>=2 then 0.2 else 0 end) ) as rec_score
    from cand c
  ),
  ranked as (
    select s.*, row_number() over (partition by s.owner_user_id order by rec_score desc) artist_rn from scored s where rec_score > 0
  )
  select r.id, r.title, r.artist, r.main_genre, r.mood, r.cover_url, r.audio_url, r.duration,
         round(r.rec_score,4),
         (case when r.gsc>0 and r.gsc=greatest(r.gsc,r.msc,r.asc_) then '자주 듣는 장르'
               when r.msc>0 and r.msc>=r.gsc then '자주 듣는 분위기'
               when r.asc_>0 then '관심 아티스트'
               when r.created_at>now()-interval '21 days' then '신곡'
               else '추천' end)::text
  from ranked r where artist_rn <= 2
  order by rec_score desc limit p_limit;
end; $function$;

-- 2) refresh_user_music_preferences : 장르 선호 집계 키에서 genre 폴백 제거 → main_genre
create or replace function public.refresh_user_music_preferences(p_user_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_user_id is null then return; end if;
  with per_track as (
    select se.track_id, t.main_genre as genre, t.mood, se.artist_user_id,
           least(sum(
             (case se.event_type when 'complete' then 4 when 'milestone_30s' then 2 else 1 end)
             * (case when se.created_at > now()-interval '30 days' then 1.5
                     when se.created_at > now()-interval '90 days' then 1.0 else 0.4 end)), 14) as track_score,
           count(*) filter (where se.event_type in ('milestone_30s','complete')) as plays,
           count(*) filter (where se.completed) as completes,
           max(se.created_at) as last_at
    from public.stream_events se join public.tracks t on t.id = se.track_id
    where se.user_id = p_user_id and se.created_at > now()-interval '180 days'
      and se.event_type in ('start','milestone_30s','complete') and t.release_status='released'
    group by se.track_id, t.main_genre, t.mood, se.artist_user_id
  ),
  liked as (
    select t.main_genre as genre, t.mood, t.owner_user_id as artist_user_id, 5::numeric bonus
    from public.liked_tracks lt join public.tracks t on t.id = lt.track_id
    where lt.user_id = p_user_id and t.release_status='released'
  ),
  combined as (
    select ptype, pkey, sum(sc) sc, sum(pc) pc, sum(cc) cc, max(la) la from (
      select 'genre'::text ptype, genre pkey, sum(track_score) sc, sum(plays) pc, sum(completes) cc, max(last_at) la from per_track where nullif(trim(coalesce(genre,'')),'') is not null group by genre
      union all select 'genre', genre, sum(bonus), 0,0,null from liked where nullif(trim(coalesce(genre,'')),'') is not null group by genre
      union all select 'mood', mood, sum(track_score), sum(plays), sum(completes), max(last_at) from per_track where nullif(trim(coalesce(mood,'')),'') is not null group by mood
      union all select 'mood', mood, sum(bonus), 0,0,null from liked where nullif(trim(coalesce(mood,'')),'') is not null group by mood
      union all select 'artist', artist_user_id::text, sum(track_score), sum(plays), sum(completes), max(last_at) from per_track where artist_user_id is not null group by artist_user_id
    ) x group by ptype, pkey
  )
  insert into public.user_music_preferences(user_id, preference_type, preference_key, score, play_count, completed_count, last_played_at, updated_at)
  select p_user_id, ptype, pkey, round(sc,2), pc, cc, la, now() from combined
  on conflict (user_id, preference_type, preference_key) do update set
    score=excluded.score, play_count=excluded.play_count, completed_count=excluded.completed_count,
    last_played_at=excluded.last_played_at, updated_at=now();
  delete from public.user_music_preferences ump
  where ump.user_id = p_user_id and ump.updated_at < now() - interval '1 second';
end; $function$;

-- 3) derive_track_analysis : track_analysis.genre 소스에서 genre 폴백 제거 → main_genre
create or replace function public.derive_track_analysis(p_track_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare t record; v_energy int;
begin
  select * into t from public.tracks where id = p_track_id;
  if t.id is null then return; end if;
  v_energy := least(100, greatest(0, coalesce(t.energy_level, 3) * 20));
  insert into public.track_analysis as a
    (track_id, genre, bpm, mood_tags, energy, danceability, valence,
     vocal_presence, instrumentalness, loudness, duration, quality_score, analyzed_at)
  values (
    t.id,
    nullif(btrim(coalesce(t.main_genre, '')), ''),
    t.bpm,
    case when coalesce(array_length(t.mood_tags,1),0) > 0 then t.mood_tags
         when nullif(btrim(coalesce(t.mood,'')),'') is not null then array[t.mood]
         else '{}'::text[] end,
    v_energy,
    v_energy,
    v_energy,
    case when coalesce(t.instrumental,false) then 10 else 80 end,
    case when coalesce(t.instrumental,false) then 90 else 20 end,
    null,
    t.duration,
    70 + case when t.duration between 60 and 420 then 10 else 0 end
  , now())
  on conflict (track_id) do update set
    genre=excluded.genre, bpm=excluded.bpm, mood_tags=excluded.mood_tags, energy=excluded.energy,
    danceability=excluded.danceability, valence=excluded.valence, vocal_presence=excluded.vocal_presence,
    instrumentalness=excluded.instrumentalness, duration=excluded.duration, quality_score=excluded.quality_score,
    analyzed_at=now();
end; $function$;

-- 4) _ai_check_store_guardrails : 장르 배열에서 genre 제거 → array[main_genre] || genre_tags
create or replace function public._ai_check_store_guardrails(p_track_id uuid, p_store_key text)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  f record; t record; m record; g record;
  v_tgen text[]; v_mood text; fv numeric; viol boolean; hit boolean;
  v_violations jsonb := '[]'::jsonb; v_pen numeric := 0; v_max_sev text := null; v_blocked boolean := false;
begin
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

-- 5) recompute_track_ai_metadata : 장르 배열에서 genre 제거 → array[main_genre] || genre_tags
create or replace function public.recompute_track_ai_metadata(p_track_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
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
  select tr.id, tr.bpm as r_bpm, tr.energy_level, tr.mood, tr.main_genre, tr.genre_tags,
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
    select public._ai_norm_genre(x) g from unnest(array_remove(array[t.main_genre] || coalesce(t.genre_tags,'{}'), null)) x
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
end; $function$;

-- 6) admin_flag_restaurant_reclassify : 재분류 휴리스틱 텍스트에서 genre 제거 → main_genre + genre_tags
create or replace function public.admin_flag_restaurant_reclassify()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_n int := 0; v_sug text; v_g text;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in
    select t.id, t.main_genre, t.genre_tags, (m.ai_moods)[1] ai_mood, f.energy
    from public.tracks t
    left join public.track_ai_metadata m on m.track_id=t.id
    left join public.track_audio_features f on f.track_id=t.id and f.status='done'
    where t.source_type='artist_upload' and t.removed_at is null
      and exists (select 1 from unnest(coalesce(t.business_type_tags,'{}')) tag where public._ai_tag_to_store_key(tag)='restaurant')
  loop
    v_g := lower(coalesce(r.main_genre,'') || ' ' || array_to_string(coalesce(r.genre_tags,'{}'),' '));
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
end; $function$;

-- 7) admin_list_metadata_violations : 진단 출력에서 legacy genre 키 제거 (main_genre 만 노출)
create or replace function public.admin_list_metadata_violations(p_status text default null::text)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.last_detected_at desc), '[]'::jsonb) into v from (
    select c.id, c.playlist_id, c.track_id, c.skip_count, c.status, c.reason,
      c.first_detected_at, c.last_detected_at, c.reviewed_at, c.admin_note,
      t.title, t.artist, t.main_genre, t.mood, t.energy_level,
      p.title as playlist_title, p.category as playlist_category,
      (select count(*) from public.playlist_track_skip_events e
         where e.playlist_id=c.playlist_id and e.track_id=c.track_id
           and e.played_seconds>=5 and (e.track_duration is null or e.track_duration<=0 or e.played_seconds<0.3*e.track_duration)) as playlist_skip_count,
      (select count(*) from public.playlist_track_skip_events e
         where e.track_id=c.track_id
           and e.played_seconds>=5 and (e.track_duration is null or e.track_duration<=0 or e.played_seconds<0.3*e.track_duration)) as total_skip_count,
      (select round(avg(e.played_seconds)::numeric,1) from public.playlist_track_skip_events e
         where e.playlist_id=c.playlist_id and e.track_id=c.track_id and e.played_seconds>=5) as avg_played_before_skip
    from public.metadata_violation_candidates c
    join public.tracks t on t.id=c.track_id
    join public.playlists p on p.id=c.playlist_id
    where p_status is null or c.status = p_status
  ) x;
  return v;
end; $function$;
