-- 0114 — 자동 배치 엔진 + 발매 트리거 + 생성/실행/토글 RPC

create or replace function public.auto_place_track(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  t record; a record; r record;
  v_artist_key text;
  v_threshold numeric := 30; v_max int := 5; v_artist_cap int := 3;
  v_placed int := 0; v_cand int := 0; v_log jsonb := '[]'::jsonb;
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
    select p.id, p.title,
      (
        coalesce(case when a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)) then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) * 15, 0)
      + coalesce(case when p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}'))) then 20 else 0 end,0)
      + coalesce(case when p.daypart is not null and p.daypart = any(coalesce(t.time_slots,'{}')) then 10 else 0 end,0)
      + coalesce(case when p.bpm_min is not null and a.bpm is not null then (case when a.bpm between p.bpm_min and coalesce(p.bpm_max,9999) then 10 else -10 end) else 0 end,0)
      + coalesce(case when p.energy_min is not null and a.energy is not null then (case when a.energy between p.energy_min and coalesce(p.energy_max,100) then 10 else -5 end) else 0 end,0)
      + coalesce(case when p.vocal_preference='vocal' then (case when coalesce(t.instrumental,false) then -10 else 10 end)
                      when p.vocal_preference='instrumental' then (case when coalesce(t.instrumental,false) then 10 else -10 end)
                      else 0 end,0)
      + coalesce(a.quality_score - 70, 0)
      + case when t.created_at >= now() - interval '30 days' then 5 else 0 end
      )::numeric as score
    from public.playlists p
    where p.is_auto_generated = true and p.status = 'released'
    order by score desc
  loop
    exit when v_placed >= v_max or r.score < v_threshold;
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
        round(r.score,1),
        format('자동 배치 (genre/mood/업종/시간 적합 · score %s)', round(r.score,1)), 'auto');
      v_placed := v_placed + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'placed', true);
    exception when unique_violation then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'already_placed');
    end;
  end loop;

  insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
  values (p_track_id, case when v_placed > 0 then 'placed' else 'review' end, v_cand, v_placed, v_log);
  return jsonb_build_object('ok', true, 'placed', v_placed, 'candidates', v_cand,
    'status', case when v_placed > 0 then 'placed' else 'review' end);
end; $function$;

create or replace function public._auto_place_on_release()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_enabled boolean;
begin
  if TG_OP = 'UPDATE' and OLD.release_status is not distinct from NEW.release_status then return NEW; end if;
  if NEW.release_status <> 'released' then return NEW; end if;
  select coalesce((value)::text::boolean, true) into v_enabled from public.admin_settings where key = 'auto_placement_enabled';
  if not coalesce(v_enabled, true) then return NEW; end if;
  begin perform public.auto_place_track(NEW.id);
  exception when others then
    insert into public.auto_placement_runs(track_id,status,log_json) values (NEW.id,'error',jsonb_build_object('err',SQLERRM));
  end;
  return NEW;
end; $function$;

drop trigger if exists trg_auto_place_on_release on public.tracks;
create trigger trg_auto_place_on_release
  after insert or update of release_status on public.tracks
  for each row when (NEW.release_status = 'released')
  execute function public._auto_place_on_release();

create or replace function public.admin_generate_auto_playlists()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_created int := 0; v_id uuid; rec record;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for rec in
    select * from (values
      ('카페 · 오전 산뜻한 음악','상쾌한 하루의 시작','오전 카페에 어울리는 산뜻한 음악','카페','morning', array['산뜻한','경쾌한'], array['pop','acoustic'], 90,130,40,80,'any','sunrise',90),
      ('카페 · 오후 잔잔한 로파이','나른한 오후','오후 카페 무드의 잔잔한 로파이','카페','afternoon', array['잔잔한','따뜻한'], array['lofi','acoustic'], 60,100,20,60,'any','warm',80),
      ('와인바 · 저녁 무드','깊어가는 저녁','와인바 저녁에 어울리는 무드 음악','와인바','evening', array['고급스러운','잔잔한'], array['jazz','rnb'], 60,110,20,60,'any','wine',95),
      ('와인바 · 심야 몽환','늦은 밤의 여운','심야 와인바의 몽환적 사운드','와인바','late', array['몽환적인','고급스러운'], array['electronic','lofi'], 70,110,20,60,'any','midnight',70),
      ('헬스장 · 에너지 음악','운동을 위한 비트','헬스장에 어울리는 에너지 트랙','헬스장','afternoon', array['에너지 있는','트렌디한'], array['electronic','kpop-style','pop'], 120,160,70,100,'any','energy',95),
      ('식당 · 점심 잔잔한 음악','편안한 식사','식당 점심에 어울리는 잔잔한 음악','식당','lunch', array['잔잔한','따뜻한'], array['acoustic','ballad'], 70,110,20,60,'any','meal',85),
      ('미용실 · 오후 트렌디 팝','감각적인 오후','미용실에 어울리는 트렌디한 팝','미용실','afternoon', array['트렌디한','산뜻한'], array['pop','kpop-style'], 100,135,50,90,'vocal','trendy',80),
      ('편집샵 · 감각적인 일렉트로닉','공간을 채우는 사운드','편집샵 무드의 감각적인 일렉트로닉','편집샵','afternoon', array['트렌디한','몽환적인'], array['electronic'], 100,140,50,90,'any','neon',75),
      ('호텔 라운지 · 고급스러운 재즈','품격 있는 공간','호텔 라운지에 어울리는 고급 재즈','호텔','evening', array['고급스러운','잔잔한'], array['jazz'], 60,110,20,60,'any','lounge',85),
      ('사무실 · 집중을 돕는 로파이','일에 집중','사무실 집중을 돕는 로파이','사무실','morning', array['잔잔한'], array['lofi'], 60,100,20,55,'instrumental','focus',80),
      ('라운지 · 심야 몽환','밤의 분위기','라운지 심야의 몽환적 무드','라운지','late', array['몽환적인','고급스러운'], array['electronic','lofi'], 70,115,20,65,'any','aurora',70),
      ('병원 · 오후 따뜻한 음악','편안함을 주는','병원 대기 공간의 따뜻한 음악','병원','afternoon', array['따뜻한','잔잔한'], array['acoustic','ballad'], 60,100,20,50,'any','calm',60)
    ) as v(title,subtitle,description,business_category,daypart,mood_tags,genre_tags,bpm_min,bpm_max,energy_min,energy_max,vocal_preference,cover_theme,priority_score)
  loop
    if exists (select 1 from public.playlists where title = rec.title and is_auto_generated = true) then continue; end if;
    insert into public.playlists
      (title, subtitle, description, category, business_category, daypart, time_slot, is_business_only,
       mood_tags, genre_tags, bpm_min, bpm_max, energy_min, energy_max, vocal_preference, cover_theme,
       is_auto, is_auto_generated, status, released_at, priority_score, sort_order)
    values
      (rec.title, rec.subtitle, rec.description, rec.business_category, rec.business_category, rec.daypart, rec.daypart, true,
       rec.mood_tags, rec.genre_tags, rec.bpm_min, rec.bpm_max, rec.energy_min, rec.energy_max, rec.vocal_preference, rec.cover_theme,
       false, true, 'released', now(), rec.priority_score, 100 - rec.priority_score)
    returning id into v_id;
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_created);
end; $function$;
grant execute on function public.admin_generate_auto_playlists() to authenticated;

create or replace function public.admin_run_auto_placement(p_track_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid; v_placed int := 0; v_runs int := 0;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  if p_track_id is not null then return public.auto_place_track(p_track_id); end if;
  for v_id in
    select id from public.tracks where release_status='released' and coalesce(audio_url,'')<>'' order by created_at desc limit 500
  loop
    v_runs := v_runs + 1;
    v_placed := v_placed + coalesce((public.auto_place_track(v_id)->>'placed')::int, 0);
  end loop;
  return jsonb_build_object('ok', true, 'tracks_processed', v_runs, 'total_placed', v_placed);
end; $function$;
grant execute on function public.admin_run_auto_placement(uuid) to authenticated;

create or replace function public.set_auto_placement_enabled(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  insert into public.admin_settings(key,value) values('auto_placement_enabled', to_jsonb(p_enabled))
    on conflict (key) do update set value = to_jsonb(p_enabled);
  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end; $function$;
grant execute on function public.set_auto_placement_enabled(boolean) to authenticated;
