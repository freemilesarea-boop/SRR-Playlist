-- 0567_notice_push.sql
--
-- 공지사항 → 앱 푸시 알림 (웹 PWA 구독 + iOS/Android 앱 토큰 전체).
--
-- 흐름
--   관리자가 공지를 공개하면서 '푸시 보내기'를 고르거나, 목록에서 '푸시 보내기'를 누른다
--   → admin_send_notice_push(id): 공개 글만, 한 번만(다시 보내려면 p_resend) push_status='pending'
--   → 바로 엣지함수 dispatch-notice-push 를 깨운다(pg_net). 깨우기에 실패해도 5분마다 cron 이 다시 깨운다.
--   → 엣지함수: cron_claim_notice_push() 로 한 건 잡고(sending) → cron_list_notice_push_targets() 의
--     모든 웹 구독·앱 토큰에 발송 → 만료 토큰 삭제 → cron_finish_notice_push() 로 결과 기록.
--   멈춘 발송(sending 15분 이상)은 다시 pending 으로 돌려 재시도한다.
--
-- 인증: 다른 cron 엣지함수와 같은 Vault 'brand_alert_secret' 을 x-cron-secret 으로 보낸다(0545).
-- 받는 사람: 푸시를 허용한 모든 기기(로그인 여부·회원 종류 무관 — 공지는 모두에게 같은 내용).

alter table public.notice_posts
  add column if not exists push_status      text,
  add column if not exists push_requested_at timestamptz,
  add column if not exists push_sent_at      timestamptz,
  add column if not exists push_result       jsonb,
  add column if not exists push_requested_by uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notice_posts_push_status') then
    alter table public.notice_posts add constraint notice_posts_push_status
      check (push_status is null or push_status in ('pending', 'sending', 'sent', 'failed'));
  end if;
end;
$$;

-- 엣지함수 주소 — 다른 알림 엣지함수 주소에서 만든다(0545 와 같은 방식).
insert into public.admin_settings (key, value)
select 'notice_push_url',
       to_jsonb(regexp_replace(trim(both '"' from s.value::text), '/functions/v1/.*$', '/functions/v1/dispatch-notice-push'))
  from public.admin_settings s
 where s.key = 'brand_alert_push_url'
   and trim(both '"' from s.value::text) like '%/functions/v1/%'
   and not exists (select 1 from public.admin_settings where key = 'notice_push_url');

-- 엣지함수 깨우기 (pending 이 있을 때만)
create or replace function public.cron_dispatch_notice_push()
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
  -- 멈춘 발송 되살리기
  update public.notice_posts
     set push_status = 'pending'
   where push_status = 'sending' and push_requested_at < now() - interval '15 minutes';

  if not exists (select 1 from public.notice_posts where push_status = 'pending' and deleted_at is null) then
    return null;
  end if;
  select trim(both '"' from value::text) into v_url from public.admin_settings where key = 'notice_push_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'brand_alert_secret' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000) into v_req;
  return v_req;
end;
$$;
revoke all on function public.cron_dispatch_notice_push() from public, anon, authenticated;

-- 관리자: 공지 푸시 보내기
create or replace function public.admin_send_notice_push(p_id uuid, p_resend boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._enterprise_guide_require_admin();
  v_row public.notice_posts;
begin
  select * into v_row from public.notice_posts where id = p_id and deleted_at is null for update;
  if v_row.id is null then
    raise exception 'not_found: 공지를 찾을 수 없다';
  end if;
  if not v_row.is_published then
    raise exception 'validation: 공개한 공지만 푸시를 보낼 수 있다';
  end if;
  if v_row.push_status in ('pending', 'sending') then
    raise exception 'validation: 이미 보내는 중이다';
  end if;
  if v_row.push_status = 'sent' and not coalesce(p_resend, false) then
    raise exception 'duplicate: 이미 푸시를 보낸 공지다 — 다시 보내려면 재발송을 고른다';
  end if;

  update public.notice_posts
     set push_status = 'pending', push_requested_at = now(), push_requested_by = v_admin, push_result = null
   where id = p_id
  returning * into v_row;

  insert into public.admin_operation_logs(source, category, level, status, message, details, user_id, related_id)
  values ('notice_post', 'notice_post.push', 'info', 'requested',
          format('공지 푸시 %s — %s', case when coalesce(p_resend, false) then '재발송' else '발송' end, v_row.title),
          jsonb_build_object('no', v_row.no, 'resend', coalesce(p_resend, false)), v_admin, v_row.id::text);

  perform public.cron_dispatch_notice_push();
  return jsonb_build_object('ok', true, 'id', v_row.id, 'push_status', v_row.push_status);
end;
$$;
revoke all on function public.admin_send_notice_push(uuid, boolean) from public, anon;
grant execute on function public.admin_send_notice_push(uuid, boolean) to authenticated, service_role;

-- 관리자 화면: 받을 수 있는 기기 수
create or replace function public.admin_notice_push_audience()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._enterprise_guide_require_admin();
  return jsonb_build_object(
    'web', (select count(*) from public.push_subscriptions),
    'ios', (select count(*) from public.device_push_tokens where platform = 'ios'),
    'android', (select count(*) from public.device_push_tokens where platform = 'android'),
    'users', (select count(distinct u) from (
                select user_id u from public.push_subscriptions
                union select user_id from public.device_push_tokens) x));
end;
$$;
revoke all on function public.admin_notice_push_audience() from public, anon;
grant execute on function public.admin_notice_push_audience() to authenticated, service_role;

-- ---- 엣지함수 전용 (service_role) ----
create or replace function public.cron_claim_notice_push()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.notice_posts;
begin
  select * into v_row from public.notice_posts
   where push_status = 'pending' and deleted_at is null and is_published
   order by push_requested_at
   limit 1
   for update skip locked;
  if v_row.id is null then
    -- 비공개로 바뀌거나 지워진 대기 건은 실패로 닫는다
    update public.notice_posts
       set push_status = 'failed', push_result = jsonb_build_object('error', '공개 상태가 아니어서 보내지 않음')
     where push_status = 'pending' and (deleted_at is not null or not is_published);
    return null;
  end if;
  update public.notice_posts set push_status = 'sending', push_requested_at = now() where id = v_row.id;
  return jsonb_build_object('id', v_row.id, 'no', v_row.no, 'title', v_row.title, 'category', v_row.category);
end;
$$;

create or replace function public.cron_list_notice_push_targets()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'web', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                       from public.push_subscriptions s), '[]'::jsonb),
    'native', coalesce((select jsonb_agg(jsonb_build_object('token', d.token, 'platform', d.platform))
                          from (select distinct on (token) token, platform from public.device_push_tokens) d), '[]'::jsonb));
$$;

create or replace function public.cron_finish_notice_push(p_id uuid, p_ok boolean, p_result jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notice_posts
     set push_status = case when p_ok then 'sent' else 'failed' end,
         push_sent_at = case when p_ok then now() else push_sent_at end,
         push_result = p_result
   where id = p_id and push_status = 'sending';
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'cron_claim_notice_push()',
    'cron_list_notice_push_targets()',
    'cron_finish_notice_push(uuid, boolean, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- 깨우기 실패 대비 — 5분마다 대기 건이 있으면 다시 깨운다.
do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'srr-notice-push') then
    perform cron.unschedule('srr-notice-push');
  end if;
  perform cron.schedule('srr-notice-push', '*/5 * * * *', 'select public.cron_dispatch_notice_push();');
end;
$$;
