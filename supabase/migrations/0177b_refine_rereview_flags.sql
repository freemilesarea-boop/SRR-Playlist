-- 0177b — 재검수 플래그를 "등록 매장(declared) 충돌" 기준으로 정교화 + 자동플래그 delete-rebuild(idempotent).
create or replace function public.admin_finalize_rereview()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_g jsonb; v_t jsonb; r record; v_flags int := 0; v_decl text[]; v_blocked_declared boolean;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  v_g := public.admin_recompute_guardrail_flags();
  v_t := public.admin_recompute_metadata_trust();
  delete from public.track_rereview_flags where status='open';
  for r in
    select t.id, t.release_status, t.business_type_tags,
      coalesce((select mismatch_score from public.track_ai_metadata m where m.track_id=t.id),0) as ms,
      (select integrated_lufs from public.track_audio_quality q where q.track_id=t.id order by analyzed_at desc limit 1) as lufs,
      (select passed_quality_check from public.track_audio_quality q where q.track_id=t.id order by analyzed_at desc limit 1) as qpass
    from public.tracks t where t.source_type='artist_upload' and t.removed_at is null
      and t.release_status in ('released','approved','submitted','review_pending','scheduled')
  loop
    select array_remove(array_agg(public._ai_tag_to_store_key(tag)), null) into v_decl from unnest(coalesce(r.business_type_tags,'{}')) tag;
    v_blocked_declared := exists (select 1 from public.track_guardrail_flags f where f.track_id=r.id and f.severity='hard_block' and f.store_key = any(coalesce(v_decl,'{}')));
    if v_blocked_declared then
      insert into public.track_rereview_flags(track_id, flag_type, reason) values (r.id,'guardrail_hard','등록한 매장에서 금지규칙 hard_block') on conflict (track_id, flag_type) do nothing; v_flags := v_flags + 1;
    end if;
    if (r.qpass is false) or (r.lufs is not null and (r.lufs < -14 or r.lufs > -10)) then
      insert into public.track_rereview_flags(track_id, flag_type, reason) values (r.id,'quality_review_required', format('LUFS %s / 품질검사', r.lufs)) on conflict (track_id, flag_type) do nothing; v_flags := v_flags + 1;
    end if;
    if v_blocked_declared or r.ms >= 0.5 then
      insert into public.track_rereview_flags(track_id, flag_type, reason) values (r.id,'high_risk', format('mismatch %s / 등록매장차단 %s', round(r.ms,2), v_blocked_declared)) on conflict (track_id, flag_type) do nothing; v_flags := v_flags + 1;
    end if;
    if r.release_status='released' and (v_blocked_declared or r.qpass is false) then
      insert into public.track_rereview_flags(track_id, flag_type, reason) values (r.id,'needs_re_review','공개곡 — 등록매장 충돌/품질 재검수 필요(자동 비공개 안 함)') on conflict (track_id, flag_type) do nothing; v_flags := v_flags + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'guardrail', v_g, 'trust', v_t, 'flags_upserted', v_flags);
end; $$;
grant execute on function public.admin_finalize_rereview() to authenticated;
