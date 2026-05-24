-- 0143 — 트랙 메타데이터에 언어권(language) 캡처 추가 (additive).
--   set_track_selected_metadata 에 p_language(기본 null) 추가 → 제공 시 tracks.language 갱신.
--   기존 호출(언어 미전달)은 language 를 건드리지 않음. 장르/무드/보컬 등 값은 자유 텍스트(enum/CHECK 없음)라
--   프론트 상수 확장만으로 동작하며, 이 마이그레이션은 언어 컬럼 연결만 담당.
--   파라미터 시그니처가 바뀌므로 DROP 후 재생성(오버로드 모호성 방지). 데이터 변경 없음.

drop function if exists public.set_track_selected_metadata(uuid, text[], text[], text[], text, text[]);
create or replace function public.set_track_selected_metadata(
  p_track_id uuid, p_genre_tags text[], p_mood_tags text[], p_business_type_tags text[],
  p_vocal_type text, p_dayparts text[], p_language text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_is_admin boolean; v_owner uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select exists(select 1 from public.users u where u.id=v_uid and u.role='admin') into v_is_admin;
  select owner_user_id into v_owner from public.tracks where id = p_track_id;
  if v_owner is null then raise exception 'track not found'; end if;
  if not v_is_admin and v_owner <> v_uid then raise exception 'forbidden'; end if;

  -- 필수 + 최대 개수 (서버 가드)
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
    genre_tags = p_genre_tags,
    mood_tags = p_mood_tags,
    business_type_tags = p_business_type_tags,
    business_tags = p_business_type_tags,         -- 엔진 호환
    time_slots = p_dayparts,                      -- 엔진 호환 (daypart 코드)
    recommended_dayparts = p_dayparts,
    vocal_type = p_vocal_type,
    lyric_type = p_vocal_type,
    instrumental = (p_vocal_type = 'instrumental'),
    main_genre = p_genre_tags[1],
    mood = p_mood_tags[1],
    suitable_store = p_business_type_tags[1],
    language = coalesce(nullif(btrim(p_language), ''), language),  -- 0143: 언어권(선택)
    metadata_source = 'artist_selected'
  where id = p_track_id;

  perform public.derive_track_analysis(p_track_id);
  return jsonb_build_object('ok', true, 'track_id', p_track_id);
end; $function$;
revoke execute on function public.set_track_selected_metadata(uuid, text[], text[], text[], text, text[], text) from public, anon;
grant execute on function public.set_track_selected_metadata(uuid, text[], text[], text[], text, text[], text) to authenticated;

drop function if exists public.admin_update_track_tags(uuid, text[], text[], text[], text, text[]);
create or replace function public.admin_update_track_tags(
  p_track_id uuid, p_genre_tags text[], p_mood_tags text[], p_business_type_tags text[],
  p_vocal_type text, p_dayparts text[], p_language text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return public.set_track_selected_metadata(p_track_id, p_genre_tags, p_mood_tags, p_business_type_tags, p_vocal_type, p_dayparts, p_language);
end; $function$;
revoke execute on function public.admin_update_track_tags(uuid, text[], text[], text[], text, text[], text) from public, anon;
grant execute on function public.admin_update_track_tags(uuid, text[], text[], text[], text, text[], text) to authenticated;

-- admin_get_track_tags: 출력에 language 추가 (시그니처 동일 → CREATE OR REPLACE)
create or replace function public.admin_get_track_tags(p_track_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'language', t.language,
    'metadata_source', t.metadata_source
  ) into v from public.tracks t where t.id = p_track_id;
  return v;
end; $function$;
