-- 0544_hq_upload_cleanup.sql
--
-- 본사가 취소한 요청(또는 올리기만 하고 요청 전송에 실패한) 파일을 정리한다.
--
-- 왜
--   본사 검수 전 업로드는 공개 버킷의 hq/<본사 id>/ 에 남는다. 관리자 반려 시에는 관리자 화면이
--   지우지만(0543 후속), 본사가 취소한 요청의 파일은 본사에 삭제 권한이 없어 계속 공개로 남았다.
--   SQL 로 storage.objects 행만 지우면 실제 파일은 남으므로, 정리는 Storage API(본사 화면)로 하고
--   DB 는 "무엇을 지워도 되는지"만 정한다.
--
-- 바뀌는 것
--   · _hq_upload_in_use(bucket, name) — 검수 대기 요청이나 실제 매장 자산이 쓰는 파일인가.
--   · storage 삭제 정책 2개 — 본사는 자기 hq/<본사 id>/ 폴더의, 쓰이지 않는 파일만 지울 수 있다.
--   · hq_list_orphan_uploads() — 지워도 되는(1시간 넘게 쓰이지 않은) 내 업로드 목록.
--     막 올리고 요청을 보내는 중인 파일을 지우지 않도록 1시간 여유를 둔다.

create or replace function public._hq_upload_in_use(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
      select 1 from public.hq_content_requests r
       where r.status = 'pending'
         and r.payload->>'file_path' = p_name
         and r.kind = case p_bucket when 'brand-media' then 'media_add' else 'announcement_asset_add' end)
    or (p_bucket = 'brand-media' and exists (
      select 1 from public.brand_media_assets m
       where m.deleted_at is null
         and m.image_url like '%/storage/v1/object/public/brand-media/' || p_name))
    or (p_bucket = 'enterprise-announcements' and exists (
      select 1 from public.enterprise_announcement_assets a
       where a.deleted_at is null and a.file_path = p_name));
$$;
revoke all on function public._hq_upload_in_use(text, text) from public, anon;
-- 스토리지 정책(호출자 권한으로 평가)에서 쓰므로 authenticated 에 실행 권한이 필요하다.
grant execute on function public._hq_upload_in_use(text, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'brand_media_hq_delete_unused') then
    create policy brand_media_hq_delete_unused on storage.objects for delete to authenticated
      using (
        bucket_id = 'brand-media'
        and (storage.foldername(name))[1] = 'hq'
        and (storage.foldername(name))[2] = public._hq_current_enterprise_account_id()::text
        and not public._hq_upload_in_use(bucket_id, name)
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'enterprise_announcements_hq_delete_unused') then
    create policy enterprise_announcements_hq_delete_unused on storage.objects for delete to authenticated
      using (
        bucket_id = 'enterprise-announcements'
        and (storage.foldername(name))[1] = 'hq'
        and (storage.foldername(name))[2] = public._hq_current_enterprise_account_id()::text
        and not public._hq_upload_in_use(bucket_id, name)
      );
  end if;
end;
$$;

create or replace function public.hq_list_orphan_uploads()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ea uuid := public._hq_current_enterprise_account_id();
begin
  if v_ea is null then
    raise exception 'forbidden: not an enterprise HQ admin' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name))
      from (
        select o.bucket_id, o.name
          from storage.objects o
         where o.bucket_id in ('brand-media', 'enterprise-announcements')
           and o.name like 'hq/' || v_ea::text || '/%'
           and o.created_at < now() - interval '1 hour'
           and not public._hq_upload_in_use(o.bucket_id, o.name)
         order by o.created_at
         limit 100
      ) o), '[]'::jsonb);
end;
$$;
revoke all on function public.hq_list_orphan_uploads() from public, anon;
grant execute on function public.hq_list_orphan_uploads() to authenticated;
