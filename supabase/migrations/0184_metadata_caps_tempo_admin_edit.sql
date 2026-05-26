-- 0184 — 업로드 메타 입력 제한(장르1/무드2/매장3) + tempo_feel + 관리자 수정 후 자동 recompute + 기존곡 정리 플래그.
-- 자동 삭제/비공개 없음. release_status 미변경. stream_events/정산/차트 미접근.

alter table public.tracks add column if not exists tempo_feel text;
alter table public.tracks drop constraint if exists tracks_tempo_feel_check;
alter table public.tracks add constraint tracks_tempo_feel_check check (tempo_feel is null or tempo_feel in ('slow','medium','fast'));

-- 재검수 플래그에 metadata_cleanup_required 추가
alter table public.track_rereview_flags drop constraint if exists track_rereview_flags_flag_type_check;
alter table public.track_rereview_flags add constraint track_rereview_flags_flag_type_check
  check (flag_type in ('needs_re_review','high_risk','quality_review_required','guardrail_hard','metadata_cleanup_required'));

-- 기존 7-arg 함수 제거 후 8-arg(tempo 포함)로 재생성 (오버로드 모호성 방지)
drop function if exists public.admin_update_track_tags(uuid, text[], text[], text[], text, text[], text);
drop function if exists public.set_track_selected_metadata(uuid, text[], text[], text[], text, text[], text);

create or replace function public.set_track_selected_metadata(
  p_track_id uuid, p_genre_tags text[], p_mood_tags text[], p_business_type_tags text[],
  p_vocal_type text, p_dayparts text[], p_language text default null, p_tempo_feel text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_is_admin boolean; v_owner uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select exists(select 1 from public.users u where u.id=v_uid and u.role='admin') into v_is_admin;
  select owner_user_id into v_owner from public.tracks where id = p_track_id;
  if v_owner is null then raise exception 'track not found'; end if;
  if not v_is_admin and v_owner <> v_uid then raise exception 'forbidden'; end if;

  -- 필수
  if coalesce(array_length(p_genre_tags,1),0) < 1 then raise exception '장르를 선택해주세요'; end if;
  if coalesce(array_length(p_mood_tags,1),0) < 1 then raise exception '분위기를 1개 이상 선택해주세요'; end if;
  if coalesce(array_length(p_business_type_tags,1),0) < 1 then raise exception '추천 매장을 1개 이상 선택해주세요'; end if;
  if coalesce(array_length(p_dayparts,1),0) < 1 then raise exception '추천 시간대를 1개 이상 선택해주세요'; end if;
  if nullif(btrim(coalesce(p_vocal_type,'')),'') is null then raise exception '보컬 유형을 선택해주세요'; end if;
  if coalesce(p_tempo_feel,'') not in ('slow','medium','fast') then raise exception '곡의 체감 템포를 선택해주세요'; end if;
  -- 최대 개수 (신규 정책: 장르 1 / 무드 2 / 매장 3 / 시간대 3)
  if array_length(p_genre_tags,1) > 1 then raise exception '장르는 1개만 선택할 수 있습니다'; end if;
  if array_length(p_mood_tags,1) > 2 then raise exception '분위기는 최대 2개까지 선택할 수 있습니다'; end if;
  if array_length(p_business_type_tags,1) > 3 then raise exception '추천 매장은 최대 3개까지 선택할 수 있습니다'; end if;
  if array_length(p_dayparts,1) > 3 then raise exception '추천 시간대는 최대 3개'; end if;

  update public.tracks set
    genre_tags = p_genre_tags, mood_tags = p_mood_tags,
    business_type_tags = p_business_type_tags, business_tags = p_business_type_tags,
    time_slots = p_dayparts, recommended_dayparts = p_dayparts,
    vocal_type = p_vocal_type, lyric_type = p_vocal_type,
    instrumental = (p_vocal_type = 'instrumental'),
    main_genre = p_genre_tags[1], mood = p_mood_tags[1], suitable_store = p_business_type_tags[1],
    language = coalesce(nullif(btrim(p_language), ''), language),
    tempo_feel = p_tempo_feel,
    metadata_source = 'artist_selected'
  where id = p_track_id;

  perform public.derive_track_analysis(p_track_id);
  return jsonb_build_object('ok', true, 'track_id', p_track_id);
end; $$;
grant execute on function public.set_track_selected_metadata(uuid, text[], text[], text[], text, text[], text, text) to authenticated;

-- 관리자 메타 수정 + 전체 recompute (모든 release_status 에서 가능, release_status 미변경)
create or replace function public.admin_update_track_tags(
  p_track_id uuid, p_genre_tags text[], p_mood_tags text[], p_business_type_tags text[],
  p_vocal_type text, p_dayparts text[], p_language text default null, p_tempo_feel text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  perform public.set_track_selected_metadata(p_track_id, p_genre_tags, p_mood_tags, p_business_type_tags, p_vocal_type, p_dayparts, p_language, p_tempo_feel);
  -- 수정 후 상태 동기화
  perform public.recompute_track_ai_metadata(p_track_id);
  perform public._rereview_recompute_track_guardrails(p_track_id);
  perform public.recompute_track_fit_scores(p_track_id);
  perform public._rereview_reflag_track(p_track_id);
  -- 정리 필요 플래그가 있었으면 해소 처리
  update public.track_rereview_flags set status='resolved', disposition='metadata_fixed', resolved_by=auth.uid(), resolved_at=now()
  where track_id=p_track_id and flag_type='metadata_cleanup_required' and status='open';
  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'recomputed', true);
end; $$;
grant execute on function public.admin_update_track_tags(uuid, text[], text[], text[], text, text[], text, text) to authenticated;

create or replace function public.admin_get_track_tags(p_track_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select jsonb_build_object(
    'track_id', t.id, 'title', t.title,
    'genre_tags', coalesce(t.genre_tags, '{}'),
    'mood_tags', coalesce(t.mood_tags, '{}'),
    'business_type_tags', coalesce(t.business_type_tags, coalesce(t.business_tags,'{}')),
    'recommended_dayparts', coalesce(t.recommended_dayparts, coalesce(t.time_slots,'{}')),
    'vocal_type', t.vocal_type, 'language', t.language, 'tempo_feel', t.tempo_feel,
    'metadata_source', t.metadata_source
  ) into v from public.tracks t where t.id = p_track_id;
  return v;
end; $$;

-- 기존 곡 정리 플래그: 신규 입력 기준 초과/누락 곡을 재검수 대상으로 표시 (삭제/비공개 없음)
create or replace function public.admin_flag_metadata_cleanup()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0; r record;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in
    select t.id,
      coalesce(array_length(t.genre_tags,1),0) g, coalesce(array_length(t.mood_tags,1),0) m,
      coalesce(array_length(t.business_type_tags,1),0) b, t.tempo_feel
    from public.tracks t
    where t.source_type='artist_upload' and t.removed_at is null
      and t.release_status in ('released','approved','submitted','review_pending','scheduled')
  loop
    if r.g >= 2 or r.m >= 3 or r.b >= 4 or r.tempo_feel is null then
      insert into public.track_rereview_flags(track_id, flag_type, reason)
      values (r.id, 'metadata_cleanup_required',
        format('기존 메타가 현재 입력 기준 초과/누락 (장르 %s·무드 %s·매장 %s·템포 %s)', r.g, r.m, r.b, coalesce(r.tempo_feel,'없음')))
      on conflict (track_id, flag_type) do update set reason=excluded.reason
      where public.track_rereview_flags.status='open';
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'flagged', v_n);
end; $$;
grant execute on function public.admin_flag_metadata_cleanup() to authenticated;
