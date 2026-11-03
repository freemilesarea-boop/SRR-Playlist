-- 0545_hq_upload_cleanup_cron.sql
--
-- 본사 검수 전 업로드 중 아무도 쓰지 않는 파일을 서버가 매일 정리한다.
--
-- 왜
--   0544 는 본사가 화면을 열 때 정리한다. 본사가 다시 들어오지 않으면 취소·반려·전송 실패 파일이
--   공개 버킷에 계속 남는다. 매일 한 번 서버가 마무리한다.
--
-- 흐름
--   pg_cron(매일 04:20 KST) → cron_cleanup_hq_uploads() → 엣지함수 cleanup-hq-uploads
--   → cron_list_hq_orphan_uploads() 로 지울 목록을 받아 Storage API 로 삭제.
--   (SQL 로 storage.objects 행만 지우면 실제 파일은 남는다.)
--
-- 지우는 기준(0544 _hq_upload_in_use 와 동일): hq/ 폴더 · 검수 대기 요청이 쓰지 않음 ·
-- 매장 자산(브랜드 미디어·안내 음원)이 쓰지 않음 · 6시간 지남(올리는 중인 파일 보호).
--
-- 인증: 기존 매장 알림(0505)과 같은 Vault 'brand_alert_secret' 을 x-cron-secret 으로 보내고,
-- 엣지함수는 cron_secret_matches() 로 그 Vault 값과 대조한다(함수 환경변수와 어긋나 있어도 동작).
-- 엣지함수 주소는 admin_settings.hq_upload_cleanup_url (없으면 brand_alert_push_url 기준으로 만든다).

create or replace function public.cron_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'vault'
as $$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets where name = 'brand_alert_secret' and decrypted_secret = p_secret);
$$;
revoke all on function public.cron_secret_matches(text) from public, anon, authenticated;
grant execute on function public.cron_secret_matches(text) to service_role;

create or replace function public.cron_list_hq_orphan_uploads(p_limit int default 200)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name)), '[]'::jsonb)
    from (
      select o.bucket_id, o.name
        from storage.objects o
       where o.bucket_id in ('brand-media', 'enterprise-announcements')
         and o.name like 'hq/%'
         and o.created_at < now() - interval '6 hours'
         and not public._hq_upload_in_use(o.bucket_id, o.name)
       order by o.created_at
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) o;
$$;
revoke all on function public.cron_list_hq_orphan_uploads(int) from public, anon, authenticated;
grant execute on function public.cron_list_hq_orphan_uploads(int) to service_role;

-- 엣지함수 주소 — 프로젝트마다 다르므로 기존 알림 엣지함수 주소에서 만든다.
insert into public.admin_settings (key, value)
select 'hq_upload_cleanup_url',
       to_jsonb(regexp_replace(trim(both '"' from s.value::text), '/functions/v1/.*$', '/functions/v1/cleanup-hq-uploads'))
  from public.admin_settings s
 where s.key = 'brand_alert_push_url'
   and trim(both '"' from s.value::text) like '%/functions/v1/%'
   and not exists (select 1 from public.admin_settings where key = 'hq_upload_cleanup_url');

create or replace function public.cron_cleanup_hq_uploads()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'vault'
as $$
declare
  v_url text;
  v_secret text;
  v_req bigint;
begin
  select trim(both '"' from value::text) into v_url
    from public.admin_settings where key = 'hq_upload_cleanup_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'brand_alert_secret' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('limit', 300),
    timeout_milliseconds := 60000) into v_req;
  return v_req;
end;
$$;
revoke all on function public.cron_cleanup_hq_uploads() from public, anon, authenticated;

do $$
begin
  -- pg_cron 이 없는 환경(테스트 DB 등)에서는 함수만 만들고 스케줄은 건너뛴다.
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'srr-hq-upload-cleanup') then
    perform cron.unschedule('srr-hq-upload-cleanup');
  end if;
  -- 매일 04:20 KST (= 19:20 UTC). 다른 야간 잡(19:00·19:30 UTC)과 겹치지 않게.
  perform cron.schedule('srr-hq-upload-cleanup', '20 19 * * *', 'select public.cron_cleanup_hq_uploads();');
end;
$$;
