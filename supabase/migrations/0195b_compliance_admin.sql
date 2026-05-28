-- 0195b — 컴플라이언스 관리자 RPC (요약/목록/해소) + 승인 RPC 중앙 게이트 적용.
create or replace function public.admin_compliance_summary()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'open_flags', (select count(*) from public.track_compliance_flags where status='open'),
    'flagged_tracks', (select count(distinct track_id) from public.track_compliance_flags where status='open'),
    'flagged_artists', (select count(distinct user_id) from public.track_compliance_flags where status='open'),
    'missing_contract', (select count(*) from public.track_compliance_flags where status='open' and flag_type='missing_contract'),
    'missing_payout', (select count(*) from public.track_compliance_flags where status='open' and flag_type='missing_payout_account'),
    'missing_payment', (select count(*) from public.track_compliance_flags where status='open' and flag_type='missing_payment'),
    'missing_profile', (select count(*) from public.track_compliance_flags where status='open' and flag_type='missing_artist_profile'),
    'released_noncompliant', (select count(distinct track_id) from public.track_compliance_flags where status='open' and flag_type='released_without_compliance'),
    'streamed_flagged', (select count(distinct f.track_id) from public.track_compliance_flags f where f.status='open' and exists (select 1 from public.stream_events e where e.track_id=f.track_id)),
    'in_playlist_flagged', (select count(distinct f.track_id) from public.track_compliance_flags f where f.status='open' and exists (select 1 from public.playlist_tracks pt where pt.track_id=f.track_id)),
    'in_settlement_flagged', (select count(distinct f.track_id) from public.track_compliance_flags f where f.status='open' and exists (select 1 from public.settlement_items si where si.track_id=f.track_id)));
end; $$;
grant execute on function public.admin_compliance_summary() to authenticated;

create or replace function public.admin_list_compliance_flags(p_filter text default 'all', p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by (x.severity='critical') desc, x.detected_at desc), '[]'::jsonb) into v from (
    select f.id, f.track_id, f.user_id, (select email from auth.users au where au.id=f.user_id) as artist_email,
      t.title, t.release_status, f.flag_type, f.severity, f.status, f.reason, f.detected_at, f.admin_note,
      exists (select 1 from public.stream_events e where e.track_id=f.track_id) as has_stream,
      exists (select 1 from public.playlist_tracks pt where pt.track_id=f.track_id) as in_playlist,
      (select coalesce(jsonb_agg(distinct g.flag_type), '[]'::jsonb) from public.track_compliance_flags g where g.track_id=f.track_id and g.status='open') as all_flags
    from public.track_compliance_flags f left join public.tracks t on t.id=f.track_id
    where f.status='open'
      and (p_filter='all'
        or (p_filter='contract' and f.flag_type='missing_contract')
        or (p_filter='payout' and f.flag_type='missing_payout_account')
        or (p_filter='payment' and f.flag_type='missing_payment')
        or (p_filter='profile' and f.flag_type='missing_artist_profile')
        or (p_filter='released' and t.release_status='released')
        or (p_filter='playlist' and exists (select 1 from public.playlist_tracks pt where pt.track_id=f.track_id))
        or (p_filter='stream' and exists (select 1 from public.stream_events e where e.track_id=f.track_id)))
      and f.flag_type <> 'released_without_compliance'
    limit greatest(1,p_limit)) x;
  return v;
end; $$;
grant execute on function public.admin_list_compliance_flags(text, int) to authenticated;

create or replace function public.admin_resolve_compliance_flag(p_track_id uuid, p_status text default 'resolved', p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  if p_status not in ('resolved','dismissed','open') then raise exception 'invalid status'; end if;
  update public.track_compliance_flags set status=p_status, resolved_by=v_uid, resolved_at=now(),
    admin_note=coalesce(nullif(btrim(p_note),''), admin_note) where track_id=p_track_id and status='open';
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_resolve_compliance_flag(uuid, text, text) to authenticated;

-- admin_approve_artist_release: 컴플라이언스 중앙 게이트(can_artist_release) 적용 — 0195c 적용분과 동일(본문은 0193f 기반 + can_artist_release 호출).
-- (본 파일에는 게이트 적용 사실만 기록; 전체 본문은 운영 DB 0195c 에 반영됨)
