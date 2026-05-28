-- 0196b — 일괄 재계산 / AI 메타 일괄 적용 (선택 음원 운영).
-- 둘 다 can_manage_tracks() 게이트, 최대 100곡, 곡별 partial success, admin_action_log 기록.
-- admin_apply_ai_metadata_and_recompute 는 내부적으로 users.role='admin' 만 허용하므로
-- content_admin 도 쓸 수 있도록 핵심 동작을 self-contained 로 인라인한다.

-- 선택 음원 일괄 재계산 (메타 변경 없이 AI/guardrail/fit/rereflag 재계산)
create or replace function public.admin_bulk_recompute_tracks(p_track_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(cardinality(p_track_ids), 0);
  v_results jsonb := '[]'::jsonb; v_success int := 0; v_failed int := 0;
  v_tid uuid; v_title text;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if not public.can_manage_tracks() then raise exception '일괄 재계산은 super_admin/content_admin 만 가능합니다' using errcode='42501'; end if;
  if v_n = 0 then raise exception '곡을 1개 이상 선택해주세요'; end if;
  if v_n > 100 then raise exception '한 번에 최대 100곡까지 가능합니다 (선택: %곡)', v_n; end if;

  foreach v_tid in array p_track_ids loop
    begin
      select title into v_title from public.tracks where id = v_tid;
      if not found then raise exception '곡을 찾을 수 없습니다'; end if;
      perform public.recompute_track_ai_metadata(v_tid);
      perform public._rereview_recompute_track_guardrails(v_tid);
      perform public.recompute_track_fit_scores(v_tid);
      perform public._rereview_reflag_track(v_tid);
      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object('track_id', v_tid, 'title', v_title, 'status', 'success', 'error', null);
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object('track_id', v_tid, 'title', v_title, 'status', 'failed', 'error', SQLERRM);
    end;
  end loop;

  insert into public.admin_action_log(actor_user_id, action, detail)
  values (v_uid, 'bulk_recompute_tracks', jsonb_build_object(
    'track_count', v_n, 'track_ids', to_jsonb(p_track_ids),
    'result', jsonb_build_object('success', v_success, 'failed', v_failed)));

  return jsonb_build_object('total', v_n, 'success', v_success, 'failed', v_failed, 'results', v_results);
end; $function$;

-- 선택 음원 AI 메타 일괄 적용 (AI 분석 genre/mood 를 트랙에 반영 + 재계산)
create or replace function public.admin_bulk_apply_ai_metadata(p_track_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(cardinality(p_track_ids), 0);
  v_results jsonb := '[]'::jsonb; v_success int := 0; v_failed int := 0;
  v_tid uuid; v_title text; v_aig text[]; v_aim text[];
begin
  if v_uid is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if not public.can_manage_tracks() then raise exception 'AI 메타 일괄 적용은 super_admin/content_admin 만 가능합니다' using errcode='42501'; end if;
  if v_n = 0 then raise exception '곡을 1개 이상 선택해주세요'; end if;
  if v_n > 100 then raise exception '한 번에 최대 100곡까지 가능합니다 (선택: %곡)', v_n; end if;

  foreach v_tid in array p_track_ids loop
    begin
      select title into v_title from public.tracks where id = v_tid;
      if not found then raise exception '곡을 찾을 수 없습니다'; end if;
      select ai_genres, ai_moods into v_aig, v_aim from public.track_ai_metadata where track_id = v_tid;
      if v_aig is null and v_aim is null then raise exception 'AI 분석 결과가 없습니다 — 먼저 AI 큐레이션 분석을 실행하세요'; end if;

      update public.tracks set
        genre_tags = coalesce(v_aig, genre_tags),
        mood_tags  = coalesce(v_aim, mood_tags),
        main_genre = coalesce(v_aig[1], main_genre),
        mood       = coalesce(v_aim[1], mood)
      where id = v_tid;

      perform public.recompute_track_ai_metadata(v_tid);
      update public.track_ai_metadata set status = 'reviewed', reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
        where track_id = v_tid;
      perform public._rereview_recompute_track_guardrails(v_tid);
      perform public.recompute_track_fit_scores(v_tid);
      perform public._rereview_reflag_track(v_tid);
      update public.track_rereview_flags set disposition = 'meta_applied' where track_id = v_tid and status = 'open';

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object('track_id', v_tid, 'title', v_title, 'status', 'success', 'error', null);
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object('track_id', v_tid, 'title', v_title, 'status', 'failed', 'error', SQLERRM);
    end;
  end loop;

  insert into public.admin_action_log(actor_user_id, action, detail)
  values (v_uid, 'bulk_apply_ai_metadata', jsonb_build_object(
    'track_count', v_n, 'track_ids', to_jsonb(p_track_ids),
    'result', jsonb_build_object('success', v_success, 'failed', v_failed)));

  return jsonb_build_object('total', v_n, 'success', v_success, 'failed', v_failed, 'results', v_results);
end; $function$;

revoke all on function public.admin_bulk_recompute_tracks(uuid[]) from public, anon;
revoke all on function public.admin_bulk_apply_ai_metadata(uuid[]) from public, anon;
grant execute on function public.admin_bulk_recompute_tracks(uuid[]) to authenticated;
grant execute on function public.admin_bulk_apply_ai_metadata(uuid[]) to authenticated;
