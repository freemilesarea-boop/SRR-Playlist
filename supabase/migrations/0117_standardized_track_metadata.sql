-- 0117 — 음원 메타데이터 선택형 표준화 (additive only)
--   기존 컬럼/데이터/RPC 변경 없음. 신규 표준화 컬럼 + 신규 RPC 추가.
--   submit_artist_release 는 손대지 않고, 업로드 후 set_track_selected_metadata 로 태그 저장.

alter table public.tracks
  add column if not exists genre_tags text[] not null default '{}',
  add column if not exists business_type_tags text[] not null default '{}',
  add column if not exists recommended_dayparts text[] not null default '{}',
  add column if not exists vocal_type text,
  add column if not exists metadata_source text not null default 'artist_selected';

create or replace function public.set_track_selected_metadata(
  p_track_id uuid, p_genre_tags text[], p_mood_tags text[], p_business_type_tags text[],
  p_vocal_type text, p_dayparts text[])
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_is_admin boolean; v_owner uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select exists(select 1 from public.users u where u.id=v_uid and u.role='admin') into v_is_admin;
  select owner_user_id into v_owner from public.tracks where id = p_track_id;
  if v_owner is null then raise exception 'track not found'; end if;
  if not v_is_admin and v_owner <> v_uid then raise exception 'forbidden'; end if;

  if coalesce(array_length(p_genre_tags,1),0) < 1 then raise exception '장르를 1개 이상 선택해주세요'; end if;
  if coalesce(array_length(p_mood_tags,1),0) < 1 then raise exception '분위기를 1개 이상 선택해주세요'; end if;
  if coalesce(array_length(p_business_type_tags,1),0) < 1 then raise exception '추천 매장을 1개 이상 선택해주세요'; end if;
  if coalesce(array_length(p_dayparts,1),0) < 1 then raise exception '추천 시간대를 1개 이상 선택해주세요'; end if;
  if nullif(btrim(coalesce(p_vocal_type,'')),'') is null then raise exception '보컬 유형을 선택해주세요'; end if;
  if array_length(p_genre_tags,1) > 3 then raise exception '장르는 최대 3개'; end if;
  if array_length(p_mood_tags,1) > 5 then raise exception '분위기는 최대 5개'; end if;
  if array_length(p_business_type_tags,1) > 5 then raise exception '추천 매장은 최대 5개'; end if;
  if array_length(p_dayparts,1) > 3 then raise exception '추천 시간대는 최대 3개'; end if;

  update public.tracks set
    genre_tags = p_genre_tags, mood_tags = p_mood_tags,
    business_type_tags = p_business_type_tags, business_tags = p_business_type_tags,
    time_slots = p_dayparts, recommended_dayparts = p_dayparts,
    vocal_type = p_vocal_type, lyric_type = p_vocal_type,
    instrumental = (p_vocal_type = 'instrumental'),
    main_genre = p_genre_tags[1], mood = p_mood_tags[1], suitable_store = p_business_type_tags[1],
    metadata_source = 'artist_selected'
  where id = p_track_id;

  perform public.derive_track_analysis(p_track_id);
  return jsonb_build_object('ok', true, 'track_id', p_track_id);
end; $function$;
grant execute on function public.set_track_selected_metadata(uuid, text[], text[], text[], text, text[]) to authenticated;

create or replace function public.admin_update_track_tags(
  p_track_id uuid, p_genre_tags text[], p_mood_tags text[], p_business_type_tags text[], p_vocal_type text, p_dayparts text[])
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return public.set_track_selected_metadata(p_track_id, p_genre_tags, p_mood_tags, p_business_type_tags, p_vocal_type, p_dayparts);
end; $function$;
grant execute on function public.admin_update_track_tags(uuid, text[], text[], text[], text, text[]) to authenticated;

-- 자동 배치 엔진: genre_tags 배열 매칭 인정 (scalar 매칭 유지 — additive). daypart 'all' 처리 포함.
create or replace function public.auto_place_track(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  t record; a record; r record; v_artist_key text;
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
      ( coalesce(case when (a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
                       or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))
                  then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) * 15, 0)
      + coalesce(case when p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}'))) then 20 else 0 end,0)
      + coalesce(case when p.daypart is not null and (p.daypart = any(coalesce(t.time_slots,'{}')) or 'all' = any(coalesce(t.time_slots,'{}'))) then 10 else 0 end,0)
      + coalesce(case when p.bpm_min is not null and a.bpm is not null then (case when a.bpm between p.bpm_min and coalesce(p.bpm_max,9999) then 10 else -10 end) else 0 end,0)
      + coalesce(case when p.energy_min is not null and a.energy is not null then (case when a.energy between p.energy_min and coalesce(p.energy_max,100) then 10 else -5 end) else 0 end,0)
      + coalesce(case when p.vocal_preference='vocal' then (case when coalesce(t.instrumental,false) then -10 else 10 end)
                      when p.vocal_preference='instrumental' then (case when coalesce(t.instrumental,false) then 10 else -10 end) else 0 end,0)
      + coalesce(a.quality_score - 70, 0)
      + case when t.created_at >= now() - interval '30 days' then 5 else 0 end )::numeric as score
    from public.playlists p where p.is_auto_generated = true and p.status = 'released' order by score desc
  loop
    exit when v_placed >= v_max or r.score < v_threshold;
    if v_artist_key <> '' and (
      select count(*) from public.playlist_tracks pt join public.tracks tt on tt.id = pt.track_id
      where pt.playlist_id = r.id and lower(btrim(coalesce(tt.artist,''))) = v_artist_key) >= v_artist_cap then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'artist_cap'); continue;
    end if;
    begin
      insert into public.playlist_tracks(playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
      values (r.id, p_track_id, coalesce((select max(order_index)+1 from public.playlist_tracks where playlist_id = r.id), 0),
        round(r.score,1), format('자동 배치 (genre/mood/업종/시간 적합 · score %s)', round(r.score,1)), 'auto');
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

-- 관리자 검수 화면 태그 조회 (수정 모달 prefill 용)
create or replace function public.admin_get_track_tags(p_track_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select jsonb_build_object(
    'track_id', t.id, 'title', t.title,
    'genre_tags', coalesce(t.genre_tags, '{}'),
    'mood_tags', coalesce(t.mood_tags, '{}'),
    'business_type_tags', coalesce(t.business_type_tags, coalesce(t.business_tags,'{}')),
    'recommended_dayparts', coalesce(t.recommended_dayparts, coalesce(t.time_slots,'{}')),
    'vocal_type', t.vocal_type,
    'metadata_source', t.metadata_source
  ) into v from public.tracks t where t.id = p_track_id;
  return v;
end; $function$;
grant execute on function public.admin_get_track_tags(uuid) to authenticated;
