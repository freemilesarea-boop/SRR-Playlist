-- 0194b — 관리자 무결성 RPC: 로그 목록 / 동일 SHA 중복 / 기존데이터 휴리스틱 스캔.
create or replace function public.admin_list_integrity_logs(p_days int default 7, p_filter text default 'all', p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) into v from (
    select l.id, l.batch_id, l.user_id, (select email from auth.users au where au.id=l.user_id) as artist_email,
      l.client_track_id, l.track_id, l.original_filename, l.final_audio_sha256, l.final_storage_path,
      l.audio_duration, l.transcoded, l.upload_status, l.created_at,
      (count(*) over (partition by l.final_audio_sha256)) as same_sha_count
    from public.upload_integrity_logs l
    where l.created_at > now() - make_interval(days => greatest(1, p_days)) and (p_filter <> 'failed' or l.upload_status <> 'success')
    order by l.created_at desc limit greatest(1, p_limit)) x
  where (p_filter <> 'duplicate_sha' or x.same_sha_count > 1);
  return v;
end; $$;
grant execute on function public.admin_list_integrity_logs(int, text, int) to authenticated;

create or replace function public.admin_integrity_duplicate_sha(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) into v from (
    select l.final_audio_sha256 as sha, l.user_id, (select email from auth.users au where au.id=l.user_id) as artist_email,
      count(*) n, jsonb_agg(jsonb_build_object('filename', l.original_filename, 'track_id', l.track_id, 'batch_id', l.batch_id, 'path', l.final_storage_path, 'at', l.created_at) order by l.created_at) as items
    from public.upload_integrity_logs l
    where l.upload_status='success' and l.final_audio_sha256 is not null and l.created_at > now() - make_interval(days => greatest(1,p_days))
    group by l.final_audio_sha256, l.user_id having count(*) > 1) x;
  return v;
end; $$;
grant execute on function public.admin_integrity_duplicate_sha(int) to authenticated;

create or replace function public.admin_scan_legacy_corruption(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.n desc), '[]'::jsonb) into v from (
    select t.owner_user_id, t.audio_content_length, t.duration, count(*) n,
      jsonb_agg(jsonb_build_object('track_id', t.id, 'title', t.title, 'filename', t.original_filename, 'audio_url', t.audio_url, 'created_at', t.created_at) order by t.created_at) as tracks,
      '동일 길이·콘텐츠크기 + 다른 파일명 (변환콘텐츠 중복 의심 — 실제 바이트 비교 필요)' as suspected_reason
    from public.tracks t
    where t.source_type='artist_upload' and t.removed_at is null and t.audio_content_length is not null and t.duration is not null
    group by t.owner_user_id, t.audio_content_length, t.duration
    having count(*) > 1 and count(distinct coalesce(t.original_filename, t.id::text)) > 1
    order by count(*) desc limit greatest(1, p_limit)) x;
  return v;
end; $$;
grant execute on function public.admin_scan_legacy_corruption(int) to authenticated;
