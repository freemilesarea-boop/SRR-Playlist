-- 0157 — AI 큐레이션 스코어링 엔진 v1 (Phase 3). 규칙은 SQL 단일 구현.
-- 매장 키(canonical): cafe_morning, cafe_afternoon, winebar_evening, lounge, gym, restaurant, salon, office

create or replace function public._ai_tag_to_store_key(p_tag text)
returns text language sql immutable as $$
  select case
    when p_tag ilike '%카페%' then 'cafe_afternoon'
    when p_tag ilike '%와인바%' or p_tag ilike '%라운지%' or p_tag ilike '%호텔%' or p_tag ilike '%바%' then 'winebar_evening'
    when p_tag ilike '%미용실%' or p_tag ilike '%네일%' or p_tag ilike '%살롱%' or p_tag ilike '%헤어%' then 'salon'
    when p_tag ilike '%사무실%' or p_tag ilike '%오피스%' or p_tag ilike '%업무%' then 'office'
    when p_tag ilike '%식당%' or p_tag ilike '%레스토랑%' then 'restaurant'
    when p_tag ilike '%헬스%' or p_tag ilike '%짐%' or p_tag ilike '%운동%' or p_tag ilike '%gym%' then 'gym'
    when p_tag ilike '%편집샵%' or p_tag ilike '%쇼룸%' or p_tag ilike '%플라워%' or p_tag ilike '%편집%' then 'lounge'
    else null
  end;
$$;

create or replace function public.recompute_track_ai_metadata(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  f record; t record;
  bpm numeric; en numeric; dnc numeric; ac numeric; inst numeric; voc numeric; br numeric; ts numeric; dr numeric;
  v_cafe numeric; v_cafe_m numeric; v_cafe_a numeric; v_wine numeric; v_lounge numeric;
  v_gym numeric; v_salon numeric; v_office numeric; v_rest numeric;
  v_fit jsonb; v_excl text[] := '{}'; v_energy text; v_conf numeric;
  v_mismatch numeric := 0; v_reasons text[] := '{}'; v_expl text;
  v_tag text; v_key text; v_score numeric; v_declared int := 0; v_low int := 0;
  v_moods text[] := '{}'; v_situ text[] := '{}';
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  select * into f from public.track_audio_features where track_id = p_track_id;
  select tr.id, tr.bpm as r_bpm, tr.energy_level, tr.mood, tr.main_genre, tr.genre, tr.business_type_tags, tr.vocal_type
    into t from public.tracks tr where tr.id = p_track_id;
  if t.id is null then raise exception 'track not found'; end if;

  if f.track_id is null or f.status <> 'done' then
    insert into public.track_ai_metadata(track_id, status, explanation, ai_energy_level)
    values (p_track_id, 'failed', '오디오 분석 미완료 — 분석 후 재계산 필요', 'unknown')
    on conflict (track_id) do update set status='failed', explanation='오디오 분석 미완료 — 분석 후 재계산 필요', updated_at=now();
    return jsonb_build_object('ok', false, 'reason', 'no_audio_features');
  end if;

  bpm := f.bpm; en := coalesce(f.energy,0.5); dnc := coalesce(f.danceability,0.5);
  ac := coalesce(f.acousticness,0.5); inst := coalesce(f.instrumentalness,0.3);
  voc := coalesce(f.vocal_presence,0.5); br := coalesce(f.brightness,0.5);
  ts := coalesce(f.tempo_stability,0.5); dr := f.dynamic_range;

  v_gym := 40 + (case when bpm>=120 then 20 when bpm>=110 then 10 else 0 end)
    + (case when en>=0.65 then 20 when en>=0.5 then 8 else 0 end)
    + (case when dnc>=0.55 then 12 else 0 end) + (case when ts>=0.5 then 8 else 0 end)
    - (case when bpm is not null and bpm<100 then 25 else 0 end)
    - (case when en<0.45 then 20 else 0 end) - (case when ac>0.7 then 15 else 0 end);
  v_cafe := 50 + (case when bpm between 70 and 115 then 15 else 0 end)
    + (case when en between 0.25 and 0.65 then 15 else 0 end)
    + (case when ac>=0.5 then 12 else 0 end) + (case when br between 0.3 and 0.7 then 6 else 0 end)
    - (case when en>0.8 then 20 else 0 end) - (case when bpm is not null and bpm>130 then 15 else 0 end)
    - (case when dr is not null and dr<3 then 8 else 0 end);
  v_cafe_m := v_cafe + (case when br>=0.5 then 5 else 0 end);
  v_cafe_a := v_cafe;
  v_wine := 45 + (case when en<=0.55 then 18 else 0 end) + (case when bpm between 60 and 105 then 15 else 0 end)
    + (case when greatest(ac,inst)>=0.5 then 14 else 0 end) + (case when br<=0.6 then 6 else 0 end)
    - (case when en>=0.7 then 20 else 0 end) - (case when bpm is not null and bpm>120 then 15 else 0 end);
  v_lounge := v_wine;
  v_salon := 50 + (case when en between 0.4 and 0.75 then 15 else 0 end) + (case when br>=0.45 then 10 else 0 end)
    + (case when bpm between 85 and 125 then 12 else 0 end) + (case when voc between 0.3 and 0.8 then 6 else 0 end);
  v_office := 45 + (case when inst>=0.5 then 18 else 0 end) + (case when en<=0.6 then 12 else 0 end)
    + (case when voc<=0.4 then 14 else 0 end) + (case when ts>=0.5 then 6 else 0 end)
    - (case when voc>0.7 and en>0.6 then 18 else 0 end);
  v_rest := 50 + (case when en<=0.65 then 15 else 0 end) + (case when voc<=0.7 then 10 else 0 end)
    + (case when dr is null or dr>=4 then 6 else 0 end) - (case when en>0.8 then 18 else 0 end);

  v_fit := jsonb_build_object(
    'cafe_morning', round(least(100,greatest(0,v_cafe_m))), 'cafe_afternoon', round(least(100,greatest(0,v_cafe_a))),
    'winebar_evening', round(least(100,greatest(0,v_wine))), 'lounge', round(least(100,greatest(0,v_lounge))),
    'gym', round(least(100,greatest(0,v_gym))), 'salon', round(least(100,greatest(0,v_salon))),
    'office', round(least(100,greatest(0,v_office))), 'restaurant', round(least(100,greatest(0,v_rest))));

  v_energy := case when en<0.35 then 'low' when en<0.68 then 'medium' else 'high' end;

  select coalesce(array_agg(k.key),'{}') into v_excl
  from jsonb_each_text(v_fit) as k(key,val) where (k.val)::numeric < 25;
  if not (en>0.8 and coalesce(bpm,0)>120) then v_excl := array_append(v_excl, 'club'); end if;

  if en>=0.68 then v_moods := array_append(v_moods,'energetic'); end if;
  if en<0.35 then v_moods := array_append(v_moods,'calm'); end if;
  if ac>=0.6 then v_moods := array_append(v_moods,'acoustic'); end if;
  if inst>=0.6 then v_moods := array_append(v_moods,'instrumental'); end if;
  select coalesce(array_agg(s.key order by s.v desc),'{}') into v_situ
  from (select key, value::numeric as v from jsonb_each_text(v_fit) order by value::numeric desc limit 3) s;

  if t.business_type_tags is not null then
    foreach v_tag in array t.business_type_tags loop
      v_key := public._ai_tag_to_store_key(v_tag);
      if v_key is not null and v_fit ? v_key then
        v_declared := v_declared + 1;
        v_score := (v_fit->>v_key)::numeric;
        if v_score < 40 then
          v_low := v_low + 1;
          v_reasons := array_append(v_reasons, format('등록: %s 매장이지만 %s 적합도 %s점(낮음)', v_tag, v_key, v_score));
        end if;
      end if;
    end loop;
  end if;
  if t.mood is not null and (t.mood ilike '%calm%' or t.mood like '%잔잔%' or t.mood like '%차분%') and en>=0.68 then
    v_reasons := array_append(v_reasons, format('등록 무드 차분하지만 분석 에너지 높음'));
  end if;
  if t.r_bpm is not null and bpm is not null and t.r_bpm>0 and abs(t.r_bpm-bpm) > 0.25*t.r_bpm then
    v_reasons := array_append(v_reasons, format('등록 BPM %s vs 분석 BPM %s 차이 큼', t.r_bpm, round(bpm)));
  end if;

  v_mismatch := least(1.0, (case when v_declared>0 then (v_low::numeric/v_declared)*0.6 else 0 end)
    + (case when array_length(v_reasons,1) is not null then least(0.4, (array_length(v_reasons,1)-v_low)*0.2) else 0 end));
  v_conf := case when f.analyzer='heuristic-v1' then 0.6 else 0.8 end;
  v_expl := format('에너지 %s, BPM %s. 적합도 상위: %s. %s', v_energy, coalesce(round(bpm)::text,'미상'),
    array_to_string(v_situ,', '),
    case when array_length(v_reasons,1) is not null then '불일치: '||array_to_string(v_reasons,' / ') else '등록 메타데이터와 큰 불일치 없음.' end);

  insert into public.track_ai_metadata(track_id, ai_genres, ai_moods, ai_situations, ai_energy_level, ai_vocal_type,
    ai_store_fit, ai_exclusions, metadata_confidence, mismatch_score, mismatch_reasons, explanation, status, analysis_version, updated_at)
  values (p_track_id, case when t.main_genre is not null then array[t.main_genre] else '{}' end,
    v_moods, v_situ, v_energy, t.vocal_type, v_fit, v_excl, v_conf, round(v_mismatch::numeric,3), v_reasons, v_expl, 'done', 'v1', now())
  on conflict (track_id) do update set ai_moods=excluded.ai_moods, ai_situations=excluded.ai_situations,
    ai_energy_level=excluded.ai_energy_level, ai_store_fit=excluded.ai_store_fit, ai_exclusions=excluded.ai_exclusions,
    metadata_confidence=excluded.metadata_confidence, mismatch_score=excluded.mismatch_score,
    mismatch_reasons=excluded.mismatch_reasons, explanation=excluded.explanation,
    status=case when public.track_ai_metadata.status='reviewed' then 'reviewed' else 'done' end, updated_at=now();

  return jsonb_build_object('ok', true, 'store_fit', v_fit, 'mismatch_score', round(v_mismatch::numeric,3), 'energy', v_energy, 'reasons', to_jsonb(v_reasons));
end; $$;

grant execute on function public.recompute_track_ai_metadata(uuid) to authenticated;
