-- 0188 — 관리자 메타 수정(또는 AI 적용) + recompute + 검증 + 승인 통합 RPC.
-- 승인은 submitted/review_pending/changes_requested 에만 적용. released 는 메타만 수정(상태 미변경).
-- stream_events/정산/차트/playlist_tracks 미수정. 자동 비공개 없음. 승인은 기존 admin_approve_artist_release 위임.
create or replace function public.admin_update_track_metadata_and_approve(
  p_track_id uuid,
  p_use_ai boolean default false,
  p_genre_tags text[] default null, p_mood_tags text[] default null, p_business_type_tags text[] default null,
  p_vocal_type text default null, p_dayparts text[] default null, p_language text default null, p_tempo_feel text default null,
  p_approve boolean default true, p_immediate boolean default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_rs text; v_src text;
  v_decl text[]; v_hard text[]; v_qpass boolean; v_lufs numeric;
  v_blocked text[] := '{}'; v_warn text[] := '{}'; v_approved boolean := false; v_note text;
  v_diff jsonb; v_meta jsonb; v_mismatch numeric; v_flags text[];
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  select release_status, source_type into v_rs, v_src from public.tracks where id = p_track_id;
  if v_rs is null then raise exception 'track not found'; end if;

  -- 1) 메타 갱신(+recompute) 또는 AI 적용(+recompute). 캡/템포 위반 시 여기서 raise → 승인 차단.
  if p_use_ai then
    v_diff := public.admin_apply_ai_metadata_and_recompute(p_track_id, '{"auto_resolve":false}'::jsonb);
  else
    perform public.admin_update_track_tags(p_track_id, p_genre_tags, p_mood_tags, p_business_type_tags, p_vocal_type, p_dayparts, p_language, p_tempo_feel);
  end if;

  -- 2) 검증/경고: 등록 매장 hard_block, LUFS 품질
  select array_remove(array_agg(public._ai_tag_to_store_key(tag)), null) into v_decl
    from unnest(coalesce((select business_type_tags from public.tracks where id = p_track_id), '{}')) tag;
  select array_agg(distinct f.store_key) into v_hard from public.track_guardrail_flags f
    where f.track_id = p_track_id and f.severity = 'hard_block' and f.store_key = any(coalesce(v_decl, '{}'));
  if v_hard is not null then
    v_blocked := v_blocked || format('등록 매장 금지규칙(hard_block): %s', (select string_agg(public._store_label(s), ', ') from unnest(v_hard) s));
    if exists (select 1 from unnest(v_hard) s where s in ('hospital','kids_cafe','yoga','dog_cafe')) then
      v_warn := v_warn || '민감 매장(병원/키즈카페/요가 등) 차단 — 승인 시 각별히 주의하세요';
    end if;
  end if;
  select passed_quality_check, integrated_lufs into v_qpass, v_lufs
    from public.track_audio_quality where track_id = p_track_id order by analyzed_at desc limit 1;
  if v_qpass is false then v_blocked := v_blocked || 'LUFS/품질 검사 미달'; end if;

  -- 3) 승인 (상태 게이트 + 차단/force)
  if p_approve then
    if v_src <> 'artist_upload' or v_rs not in ('submitted','review_pending','changes_requested') then
      v_note := format('현재 상태(%s)에서는 승인을 적용하지 않습니다 — 메타데이터만 수정되었습니다.', v_rs);
    elsif array_length(v_blocked, 1) is not null and not p_force then
      v_note := '차단 사유가 있어 승인하지 않았습니다. 메타 수정 후 다시 시도하거나 강제 승인하세요.';
    else
      begin
        perform public.admin_approve_artist_release(p_track_id, p_immediate);
        v_approved := true;
      exception when others then
        v_blocked := v_blocked || ('승인 실패: ' || SQLERRM);
      end;
    end if;
  end if;

  -- 4) 결과
  select coalesce(mismatch_score, 0) into v_mismatch from public.track_ai_metadata where track_id = p_track_id;
  select array_agg(distinct flag_type) into v_flags from public.track_rereview_flags where track_id = p_track_id and status = 'open';
  select jsonb_build_object('genre_tags', genre_tags, 'mood_tags', mood_tags, 'business_type_tags', business_type_tags,
    'vocal_type', vocal_type, 'recommended_dayparts', recommended_dayparts, 'tempo_feel', tempo_feel) into v_meta
    from public.tracks where id = p_track_id;

  return jsonb_build_object(
    'ok', true, 'approved', v_approved,
    'release_status', (select release_status from public.tracks where id = p_track_id),
    'blocked_reasons', to_jsonb(v_blocked), 'warnings', to_jsonb(v_warn),
    'guardrail_hard_declared', to_jsonb(coalesce(v_hard, '{}')),
    'mismatch_score', round(v_mismatch, 2), 'lufs', v_lufs,
    'open_flags', to_jsonb(coalesce(v_flags, '{}')),
    'updated_metadata', v_meta, 'note', v_note, 'recompute_diff', v_diff);
end; $$;
grant execute on function public.admin_update_track_metadata_and_approve(uuid, boolean, text[], text[], text[], text, text[], text, text, boolean, boolean, boolean) to authenticated;
