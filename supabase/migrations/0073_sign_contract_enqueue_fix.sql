-- 0073 — sign_artist_contract enqueue 오류 수정 + admin retroactive enqueue RPC
--
-- 증상:
-- 계약 서명은 성공했으나 contract_email_jobs INSERT 0건
-- artist_contracts.last_email_error: 'enqueue failed: malformed array literal: "freemilesarea@gmail.com"'
-- 결과: dispatch 호출해도 처리할 job 없음 → Resend 호출 없음 → 메일 미발송
--
-- 원인:
-- 0072 의 v_recipients text[] 추적 + ANY/|| 연산이 PL/pgSQL 파싱 오류 유발
-- sub-block exception 으로 catch 되어 signed 는 유지됐지만 jobs 0건
--
-- 조치:
-- 1) v_recipients 추적 배열 제거 — 단순 NOT EXISTS dedup 으로 통일
-- 2) enqueue 로직을 _enqueue_contract_emails 헬퍼로 분리 (재사용 가능)
-- 3) admin_enqueue_contract_emails 신규 RPC (jobs 0건 케이스 복구용)
-- 4) 기존 signed + email_status='failed' + jobs=0 계약 retroactive enqueue

create or replace function public._enqueue_contract_emails(p_contract_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_contract record;
  v_artist_email text;
  v_subject text;
  v_admin_count int := 0;
  v_total int := 0;
begin
  select c.id, c.artist_user_id, c.status, c.contract_version
    into v_contract
  from public.artist_contracts c where c.id = p_contract_id;
  if v_contract.id is null then raise exception 'contract not found'; end if;
  if v_contract.status <> 'signed' then
    raise exception 'cannot enqueue emails for status=%', v_contract.status;
  end if;

  select au.email::text into v_artist_email
  from auth.users au where au.id = v_contract.artist_user_id;

  v_subject := '[스르륵 플리] 아티스트 계약 체결 완료 - 버전 ' || v_contract.contract_version;

  if v_artist_email is not null
     and length(btrim(v_artist_email)) > 0
     and lower(v_artist_email) <> 'freemilesarea@gmail.com'
     and not exists (
       select 1 from public.contract_email_jobs j
       where j.contract_id = p_contract_id and j.recipient_email = v_artist_email
     )
  then
    insert into public.contract_email_jobs
      (contract_id, recipient_email, recipient_kind, recipient_user_id, subject)
    values
      (p_contract_id, v_artist_email, 'artist', v_contract.artist_user_id, v_subject);
    v_total := v_total + 1;
  end if;

  if not exists (
    select 1 from public.contract_email_jobs j
    where j.contract_id = p_contract_id and j.recipient_email = 'freemilesarea@gmail.com'
  ) then
    insert into public.contract_email_jobs
      (contract_id, recipient_email, recipient_kind, subject)
    values
      (p_contract_id, 'freemilesarea@gmail.com', 'hardcoded', v_subject);
    v_total := v_total + 1;
  end if;

  insert into public.contract_email_jobs
    (contract_id, recipient_email, recipient_kind, recipient_user_id, subject)
  select distinct
    p_contract_id, au.email::text, 'admin', u.id, v_subject
  from public.users u
  join auth.users au on au.id = u.id
  where u.role = 'admin'
    and au.email is not null
    and lower(au.email::text) <> coalesce(lower(v_artist_email), '')
    and lower(au.email::text) <> 'freemilesarea@gmail.com'
    and not exists (
      select 1 from public.contract_email_jobs j
      where j.contract_id = p_contract_id
        and lower(j.recipient_email) = lower(au.email::text)
    );
  get diagnostics v_admin_count = row_count;
  v_total := v_total + v_admin_count;

  update public.artist_contracts
    set email_status = 'queued',
        admin_email_delivery_count = (
          select count(*) from public.contract_email_jobs j
          where j.contract_id = p_contract_id and j.recipient_kind = 'admin'
        ),
        last_email_error = null
  where id = p_contract_id;

  return v_total;
end;
$function$;

revoke all on function public._enqueue_contract_emails(uuid) from public;
grant execute on function public._enqueue_contract_emails(uuid) to service_role;

create or replace function public.sign_artist_contract(
  p_contract_id uuid,
  p_signed_ip text default null,
  p_signed_user_agent text default null
)
returns table (contract_id uuid, status text, signed_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_contract record;
  v_signed_at timestamptz;
  v_e text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select c.id, c.artist_user_id, c.status, c.expires_at, c.contract_body, c.contract_version
    into v_contract
  from public.artist_contracts c where c.id = p_contract_id;
  if v_contract.id is null then raise exception 'contract not found'; end if;
  if v_contract.artist_user_id <> v_uid then raise exception 'forbidden'; end if;
  if v_contract.status <> 'pending_signature' then
    raise exception 'cannot sign contract in status=%', v_contract.status;
  end if;
  if v_contract.expires_at is not null and v_contract.expires_at < now() then
    update public.artist_contracts set status = 'expired' where id = p_contract_id;
    raise exception 'contract expired at %', v_contract.expires_at;
  end if;

  v_signed_at := now();

  update public.artist_contracts as c
  set status = 'signed',
      signed_at = v_signed_at,
      signed_ip = nullif(btrim(coalesce(p_signed_ip, '')), '')::inet,
      signed_user_agent = nullif(btrim(coalesce(p_signed_user_agent, '')), ''),
      contract_hash = encode(
        extensions.digest(
          (coalesce(c.contract_body,'') || '|' ||
           v_contract.artist_user_id::text || '|' ||
           to_char(v_signed_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::bytea,
          'sha256'
        ),
        'hex'
      )
  where c.id = p_contract_id;

  update public.users set contract_status = 'signed' where id = v_uid;

  begin
    perform public._enqueue_contract_emails(p_contract_id);
  exception when others then
    get stacked diagnostics v_e = message_text;
    update public.artist_contracts
      set last_email_error = 'enqueue failed: ' || v_e,
          email_status = 'failed'
    where id = p_contract_id;
  end;

  return query
  select c.id, c.status::text, c.signed_at
  from public.artist_contracts c where c.id = p_contract_id;
end;
$function$;

grant execute on function public.sign_artist_contract(uuid, text, text) to authenticated;

create or replace function public.admin_enqueue_contract_emails(p_contract_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count int;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  v_count := public._enqueue_contract_emails(p_contract_id);
  return v_count;
end;
$function$;

grant execute on function public.admin_enqueue_contract_emails(uuid) to authenticated;

DO $$
DECLARE c_id uuid;
BEGIN
  FOR c_id IN
    SELECT id FROM public.artist_contracts
    WHERE status = 'signed' AND email_status = 'failed'
      AND NOT EXISTS (SELECT 1 FROM public.contract_email_jobs j WHERE j.contract_id = artist_contracts.id)
  LOOP
    PERFORM public._enqueue_contract_emails(c_id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
