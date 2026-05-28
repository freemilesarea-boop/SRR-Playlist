-- 0196 — 선택 음원 일괄 메타데이터 수정 (관리자 운영 효율).
-- 검수/재검수/고위험/음원관리 탭에서 여러 곡의 장르/무드/매장/보컬/언어/시간대/템포를
-- 한 번에 수정. null 필드는 기존 값 유지, 곡별 partial success, audit 기록.
--
-- 권한: can_manage_tracks() (super_admin/content_admin). reviewer/curator/sales 불가.
-- 안전장치: 최대 100곡, 입력 cap 위반은 전체 시작 전 차단, release_status 변경 없음,
--          released 곡 메타 수정 허용(핵심 필드 immutable 트리거가 별도로 방어).

-- ── 1. artist_upload 가드를 RBAC content_admin/super_admin 까지 admin 으로 인정 ──
--    기존엔 users.role='admin'(legacy super) 만 admin 으로 봤기에 content_admin 이
--    released/review_pending 상태의 아티스트 곡 메타를 수정하려 하면 차단되었다.
--    (아티스트/리뷰어는 여전히 차단 — can_manage_tracks 만 추가로 통과. 핵심 필드
--     immutability 는 _tracks_immutable_fields_check / _tracks_release_protect 가 역할 무관하게 방어.)
create or replace function public._tracks_artist_update_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare v_is_admin boolean;
begin
  select (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
          or public.can_manage_tracks())
    into v_is_admin;
  if v_is_admin then return NEW; end if;
  if NEW.admin_review_note is distinct from OLD.admin_review_note
     or NEW.audio_review_status is distinct from OLD.audio_review_status
     or NEW.cover_review_status is distinct from OLD.cover_review_status
     or NEW.metadata_review_status is distinct from OLD.metadata_review_status
     or NEW.reviewed_at is distinct from OLD.reviewed_at
     or NEW.reviewed_by is distinct from OLD.reviewed_by
     or NEW.review_started_at is distinct from OLD.review_started_at
     or NEW.approved_at is distinct from OLD.approved_at
     or NEW.scheduled_at is distinct from OLD.scheduled_at
     or NEW.released_at is distinct from OLD.released_at then
    raise exception 'artist cannot modify admin review fields (id=%)', OLD.id using errcode = '42501';
  end if;
  if NEW.release_status not in ('draft','submitted','changes_requested') then
    raise exception 'artist cannot set release_status=% directly', NEW.release_status using errcode = '42501';
  end if;
  if OLD.release_status in ('review_pending','approved','scheduled','released','rejected') then
    raise exception 'artist cannot modify track in release_status=%', OLD.release_status using errcode = '42501';
  end if;
  return NEW;
end; $function$;

-- ── 2. 일괄 메타 수정 RPC ──
create or replace function public.admin_bulk_update_track_metadata(
  p_track_ids uuid[],
  p_genre text[] default null,
  p_moods text[] default null,
  p_business_type_tags text[] default null,
  p_vocal_type text default null,
  p_language text default null,
  p_time_tags text[] default null,
  p_tempo_feel text default null,
  p_recompute boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(cardinality(p_track_ids), 0);
  v_changed text[] := '{}';
  v_results jsonb := '[]'::jsonb;
  v_success int := 0;
  v_failed int := 0;
  v_tid uuid;
  v_title text;
  v_g text[]; v_m text[]; v_b text[]; v_v text; v_d text[]; v_lang text; v_t text;
begin
  -- 권한
  if v_uid is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if not public.can_manage_tracks() then
    raise exception '일괄 메타 수정은 super_admin/content_admin 만 가능합니다' using errcode='42501';
  end if;

  -- 곡 수 제한
  if v_n = 0 then raise exception '곡을 1개 이상 선택해주세요'; end if;
  if v_n > 100 then raise exception '한 번에 최대 100곡까지 수정할 수 있습니다 (선택: %곡)', v_n; end if;

  -- 입력 cap 검증 (전체 시작 전 차단). null = 변경 안 함, 빈 배열 = 금지.
  if p_genre is not null then
    if coalesce(cardinality(p_genre),0) = 0 then raise exception '장르 빈 배열은 허용되지 않습니다 (변경 안 함은 null)'; end if;
    if cardinality(p_genre) > 1 then raise exception '장르는 1개만 선택할 수 있습니다'; end if;
  end if;
  if p_moods is not null then
    if coalesce(cardinality(p_moods),0) = 0 then raise exception '분위기 빈 배열은 허용되지 않습니다 (변경 안 함은 null)'; end if;
    if cardinality(p_moods) > 2 then raise exception '분위기는 최대 2개까지 선택할 수 있습니다'; end if;
  end if;
  if p_business_type_tags is not null then
    if coalesce(cardinality(p_business_type_tags),0) = 0 then raise exception '추천 매장 빈 배열은 허용되지 않습니다 (변경 안 함은 null)'; end if;
    if cardinality(p_business_type_tags) > 3 then raise exception '추천 매장은 최대 3개까지 선택할 수 있습니다'; end if;
  end if;
  if p_time_tags is not null then
    if coalesce(cardinality(p_time_tags),0) = 0 then raise exception '추천 시간대 빈 배열은 허용되지 않습니다 (변경 안 함은 null)'; end if;
    if cardinality(p_time_tags) > 3 then raise exception '추천 시간대는 최대 3개까지 선택할 수 있습니다'; end if;
  end if;
  if p_vocal_type is not null and nullif(btrim(p_vocal_type),'') is null then
    raise exception '보컬 유형이 비어있습니다 (변경 안 함은 null)';
  end if;
  if p_tempo_feel is not null and p_tempo_feel not in ('slow','medium','fast') then
    raise exception 'tempo_feel 은 slow/medium/fast 만 허용됩니다';
  end if;

  -- 변경 필드 집계 + "변경할 필드 없음" 차단
  if p_genre is not null then v_changed := array_append(v_changed, 'genre'); end if;
  if p_moods is not null then v_changed := array_append(v_changed, 'moods'); end if;
  if p_business_type_tags is not null then v_changed := array_append(v_changed, 'business_type_tags'); end if;
  if p_vocal_type is not null then v_changed := array_append(v_changed, 'vocal_type'); end if;
  if p_language is not null and btrim(p_language) <> '' then v_changed := array_append(v_changed, 'language'); end if;
  if p_time_tags is not null then v_changed := array_append(v_changed, 'time_tags'); end if;
  if p_tempo_feel is not null then v_changed := array_append(v_changed, 'tempo_feel'); end if;
  if coalesce(cardinality(v_changed),0) = 0 then
    raise exception '변경할 필드를 1개 이상 선택해주세요 (모든 필드가 "변경 안 함")';
  end if;

  -- 곡별 처리 (partial success — 한 곡 실패가 전체를 중단하지 않음)
  foreach v_tid in array p_track_ids loop
    begin
      select title, genre_tags, mood_tags, business_type_tags, vocal_type,
             recommended_dayparts, language, tempo_feel
        into v_title, v_g, v_m, v_b, v_v, v_d, v_lang, v_t
      from public.tracks where id = v_tid;
      if not found then raise exception '곡을 찾을 수 없습니다'; end if;

      -- merge: null 파라미터는 기존 값 유지
      v_g    := coalesce(p_genre, v_g);
      v_m    := coalesce(p_moods, v_m);
      v_b    := coalesce(p_business_type_tags, v_b);
      v_v    := coalesce(p_vocal_type, v_v);
      v_d    := coalesce(p_time_tags, v_d);
      v_lang := coalesce(nullif(btrim(p_language), ''), v_lang);
      v_t    := coalesce(p_tempo_feel, v_t);

      -- denormalized 컬럼까지 set_track_selected_metadata 와 동일하게 동기화.
      -- release_status / 핵심 발매 필드는 절대 건드리지 않음.
      update public.tracks set
        genre_tags = v_g,
        main_genre = case when coalesce(array_length(v_g,1),0) >= 1 then v_g[1] else main_genre end,
        mood_tags = v_m,
        mood = case when coalesce(array_length(v_m,1),0) >= 1 then v_m[1] else mood end,
        business_type_tags = v_b, business_tags = v_b,
        suitable_store = case when coalesce(array_length(v_b,1),0) >= 1 then v_b[1] else suitable_store end,
        recommended_dayparts = v_d, time_slots = v_d,
        vocal_type = v_v, lyric_type = v_v, instrumental = (v_v = 'instrumental'),
        language = v_lang,
        tempo_feel = v_t
      where id = v_tid;

      perform public.derive_track_analysis(v_tid);
      if p_recompute then
        perform public.recompute_track_ai_metadata(v_tid);
        perform public._rereview_recompute_track_guardrails(v_tid);
        perform public.recompute_track_fit_scores(v_tid);
        perform public._rereview_reflag_track(v_tid);
      end if;

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object(
        'track_id', v_tid, 'title', v_title, 'status', 'success', 'error', null);
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object(
        'track_id', v_tid, 'title', v_title, 'status', 'failed', 'error', SQLERRM);
    end;
  end loop;

  -- bulk action 감사 로그 (곡별 메타 변경은 trg_log_metadata_change 가 자동 기록)
  insert into public.admin_action_log(actor_user_id, action, detail)
  values (v_uid, 'bulk_update_track_metadata', jsonb_build_object(
    'track_count', v_n,
    'changed_fields', to_jsonb(v_changed),
    'track_ids', to_jsonb(p_track_ids),
    'values', jsonb_build_object(
      'genre', p_genre, 'moods', p_moods, 'business_type_tags', p_business_type_tags,
      'vocal_type', p_vocal_type, 'language', p_language, 'time_tags', p_time_tags, 'tempo_feel', p_tempo_feel),
    'recompute', p_recompute,
    'result', jsonb_build_object('success', v_success, 'failed', v_failed)));

  return jsonb_build_object(
    'total', v_n, 'success', v_success, 'failed', v_failed,
    'changed_fields', to_jsonb(v_changed), 'results', v_results);
end; $function$;

revoke all on function public.admin_bulk_update_track_metadata(uuid[], text[], text[], text[], text, text, text[], text, boolean) from public, anon;
grant execute on function public.admin_bulk_update_track_metadata(uuid[], text[], text[], text[], text, text, text[], text, boolean) to authenticated;
