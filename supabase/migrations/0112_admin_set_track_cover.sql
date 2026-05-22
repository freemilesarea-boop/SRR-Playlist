-- 0112 — 관리자 커버 재등록/교체
--   업로드 단계에서 커버가 누락된 곡(cover_url=null)을 관리자가 다시 등록.
--   admin only. cover_url 갱신 + cover_review_status='approved'(관리자 확정). 다른 컬럼/정산 무관.
create or replace function public.admin_set_track_cover(p_track_id uuid, p_cover_url text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_clean text := nullif(btrim(coalesce(p_cover_url,'')), '');
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  update public.tracks
     set cover_url = v_clean,
         cover_review_status = case when v_clean is not null then 'approved' else cover_review_status end
   where id = p_track_id;
  if not found then raise exception 'track not found'; end if;
  begin
    perform admin_log_operation('track','content','info','completed',
      'set track cover', jsonb_build_object('track_id', p_track_id, 'cover_url', v_clean),
      auth.uid(), p_track_id::text, null, null, null);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'cover_url', v_clean);
end; $function$;
grant execute on function public.admin_set_track_cover(uuid, text) to authenticated;
